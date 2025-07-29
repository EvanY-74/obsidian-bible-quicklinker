import { Plugin, PluginSettingTab, Setting, Notice, Editor, EditorSuggest, App, EditorPosition, EditorSuggestTriggerInfo, EditorSuggestContext } from "obsidian";
import { ViewPlugin, PluginValue, EditorView, ViewUpdate } from '@codemirror/view';

interface PluginSettings {
	pathToBibleFolder: string;
	verseHeadingLevel?: number; // number | undefined

	singleVerseFormat: string;
	sameChapterMultiVerseFormat: string;
	diffChapterMultiVerseFormat: string;


	enableInstantLinking: boolean;
	instantLinkingChar: string,
}

const DEFAULT_SETTINGS: Partial<PluginSettings> = {
	pathToBibleFolder: "Bible",

	singleVerseFormat: "{book} {chapter}:{verse}",
	sameChapterMultiVerseFormat: "[[{book} {chapter}:{verse}]]-[[{endVerse}]]",
	diffChapterMultiVerseFormat: "[[{book} {chapter}:{verse}]]-[[{endChapter}:{endVerse}]]",

	enableInstantLinking: false,
	instantLinkingChar: '@',
}

interface Reference {
	text: string;
	book: string;
	chapter: number;
	verse?: number;
}

interface MultiReference {
	text: string;
	book: string;
	chapter: number;
	verse: number;
	endChapter: number;
	endVerse: number;
}

let books: Record<string, Record<number, number>> = {};

export default class BibleReferencePlugin extends Plugin {
	settings: PluginSettings;

	async onload() {
		console.log("Loading Bible QuickLinker");

		await this.loadSettings();
		this.addSettingTab(new BibleReferenceSettingTab(this.app, this));

		this.registerEditorSuggest(new QuickSuggest(this.app, this.settings));

		this.registerEditorExtension(ViewPlugin.define(view => new InstantLink(view, this.settings)));

		
		this.addCommand({
			id: "make-bible-link",
			name: "Make Bible link",
			editorCallback: (editor: Editor) => {
				const selectedText = editor.getSelection();
				const reference = parseBibleReference(
					selectedText,
					/^\s*((?:\d )?[A-Za-z]+(?: [A-Za-z]+)*) ?(\d+)(?: ?: ?(\d+))?\s*$/,
					/^\s*((?:\d )?[A-Za-z]+(?: [A-Za-z]+)*) ?(\d+) ?: ?(\d+) ?[-–] ?(\d+) ?(?: ?: ?(\d+))?\s*$/
				);
				
				if (!reference) {
					new Notice("Cannot make a scriptural reference link out of this selection");
					return;
				} else if (typeof reference === "string") {
					new Notice(reference);
					return;
				}
				
				editor.replaceSelection(generateLink(reference, this.settings));
			},
		});

		// Only scan after Obsidian is ready
		this.app.workspace.onLayoutReady(() => {
			scanBibleStructure(this);
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class BibleReferenceSettingTab extends PluginSettingTab {
	plugin: BibleReferencePlugin;

	constructor(app: App, plugin: BibleReferencePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl("h1", { text: "Bible QuickLinker Settings" });
		containerEl.createEl("hr");

		containerEl.createEl("h2", { text: "Scanning Bible Folder" });

		new Setting(containerEl)
			.setName("path to Bible folder")
			.setDesc("on reload, this plugin will scan for file names in this folder in the format: {Book} {Chapter}")
			.addText(text =>
				text
					.setPlaceholder("Bible")
					.setValue(this.plugin.settings.pathToBibleFolder)
					.onChange(async (value) => {
						value = value.trim();
						if (value.at(-1) == "/") value = value.slice(0, -1);
						this.plugin.settings.pathToBibleFolder = value;
						await this.plugin.saveSettings();
					})
		);

		new Setting(containerEl)
			.setName("verse heading level")
			.setDesc("(optional) define a specific heading level that a verse will be")
			.addText(text => {
				text.inputEl.type = "number";
				text
					.setPlaceholder("e.g. 3 for ### v1")
					.setValue(this.plugin.settings.verseHeadingLevel?.toString() ?? "")
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						this.plugin.settings.verseHeadingLevel = !isNaN(parsed) ? parsed : undefined;
						await this.plugin.saveSettings();
					});
				}
		);


		containerEl.createEl("h2", { text: "Formatting linking and embedding" });

		new Setting(containerEl)
			.setName("single verse format")
			.setDesc("e.g. Job 3:20")
			.addText(text =>
				text
					.setPlaceholder("{book} {chapter}:{verse}")
					.setValue(this.plugin.settings.singleVerseFormat)
					.onChange(async (value) => {
						this.plugin.settings.singleVerseFormat = value;
						await this.plugin.saveSettings();
					})
		);

		const LONG_INPUT_WIDTH = "300px";

		(new Setting(containerEl)
			.setName("multiple verses format (same chapter)")
			.setDesc("e.g. Job 3:20-21 | [[]] indicate links to the first and last verses")
			.addText(text =>
				text
					.setPlaceholder("[[{book} {chapter}:{verse}]]-[[{verse}]]")
					.setValue(this.plugin.settings.sameChapterMultiVerseFormat)
					.onChange(async (value) => {
						this.plugin.settings.sameChapterMultiVerseFormat = value;
						await this.plugin.saveSettings();
					})
		).settingEl.querySelector("input") as HTMLInputElement).style.width = LONG_INPUT_WIDTH;

		(new Setting(containerEl)
			.setName("multiple verses format (different chapters)")
			.setDesc("e.g. Job 3:20-4:1")
			.addText(text =>
				text
					.setPlaceholder("[[{book} {chapter}:{verse}]]-[[{chapter}:{verse}]]")
					.setValue(this.plugin.settings.diffChapterMultiVerseFormat)
					.onChange(async (value) => {
						this.plugin.settings.diffChapterMultiVerseFormat = value;
						await this.plugin.saveSettings();
					})
		).settingEl.querySelector("input") as HTMLInputElement).style.width = LONG_INPUT_WIDTH;

		containerEl.createEl("h2", { text: "Instant linking (Experimental)" });

		new Setting(containerEl)
			.setName("enable Instant linking")
			.setDesc("automatically convert @Genesis 1:1 into a link when typing.")
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.enableInstantLinking)
					.onChange(async (value) => {
						this.plugin.settings.enableInstantLinking = value;
						await this.plugin.saveSettings();
						this.display(); // Refresh the whole settings tab
					})
		);

		if (this.plugin.settings.enableInstantLinking) {
			new Setting(containerEl)
				.setName("start character")
				.setDesc("type this character then a verse (or chapter)")
				.addText(text =>
					text
						.setPlaceholder("@")
						.setValue(this.plugin.settings.instantLinkingChar || "@")
						.onChange(async (value) => {
							/* eslint-disable */
							this.plugin.settings.instantLinkingChar = value.replace(/[.*+?^=!:${}()|\[\]\/\\]/g, "\\$&") || "@";
							/* eslint-enable */
							await this.plugin.saveSettings();
						})
			);
		}
	}
}


// Get all the information about verses from the file structure
async function scanBibleStructure(plugin: BibleReferencePlugin) {
	books = {};

	for (const file of plugin.app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(plugin.settings.pathToBibleFolder + "/")) continue;

		// Match file names like "Genesis 1.md", "1 John 3.md", etc.
		const match = file.basename.match(/^([1-3]? ?[A-Za-z]+(?:\s[A-Za-z]+)*) ?(\d+)$/);
		if (!match) continue;

		const [, book, chapterStr ] = match;
		const chapter = parseInt(chapterStr, 10);

		const cache = plugin.app.metadataCache.getFileCache(file);
		if (!cache?.headings) continue;

		if (!books[book]) books[book] = {};
		books[book][chapter] = 0;

		let lastVerse = 0;
		for (let i = cache.headings.length - 1; i >= 0; i--) {
			const heading = cache.headings[i];
			if (plugin.settings.verseHeadingLevel && heading.level != plugin.settings.verseHeadingLevel) continue;

			const match = heading.heading.match(/\d+/);
			if (match) {
				lastVerse = parseInt(heading.heading, 10);
				break;
			}
		}

		if (lastVerse == 0) new Notice(`Could not find how many verses were in ${book} ${chapter}.`, 10000);
		books[book][chapter] = lastVerse;
		
	}
}	

class QuickSuggest extends EditorSuggest<string> {
	settings: PluginSettings;

	constructor(app: App, settings: PluginSettings) {
		super(app);
		this.settings = settings;
	}
	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line).slice(0, cursor.ch);

		const reference = parseBibleReference(
			line,
			/((?:\d )?[A-Za-z]+(?: [A-Za-z]+)*) ?(\d+)(?::(\d+))?\s?$/,
			/((?:\d )?[A-Za-z]+(?: [A-Za-z]+)*) ?(\d+) ?: ?(\d+) ?[-–] ?(\d+) ?(?: ?: ?(\d+))?\s?$/
		)
		if (!reference || typeof reference === "string") return null; // TODO? Possibly add error message if its invalid

		const lastChar = reference.text.at(-1) as string;
		return {
			start: { line: cursor.line, ch: cursor.ch - reference.text.length },
			end: { line: cursor.line, ch: cursor.ch - (/\s/.test(lastChar) ? 1 : 0) },
			query: JSON.stringify(reference)
		};
	}

	getSuggestions(context: EditorSuggestContext): string[] {
		try {
			const reference = JSON.parse(context.query);
			const multipleVerses = reference.endVerse === undefined ? "" : "s";
			return [
				reference.verse !== undefined ? "Link verse" + multipleVerses : "Link chapter",
				reference.verse !== undefined ? "Embed verse" + multipleVerses : "Embed chapter"
			];
		} catch (err) {
			if (err instanceof SyntaxError) {
				console.error("Failed to parse query:", context.query, err);
			} else throw err;
			return [];
		}
	}

	renderSuggestion(url: string, el: HTMLElement) {
		el.setText(`Replace with: ${url}`);
	}

	selectSuggestion(suggestion: string): void {
		if (!this.context) return;
		try {
			const reference = JSON.parse(this.context.query);
			let replacement = '';

			if (suggestion.startsWith("Link")) {
				replacement = generateLink(reference, this.settings);
			} else if (suggestion.startsWith("Embed")) {
				if (reference.endVerse === undefined) replacement = `![[${reference.book} ${reference.chapter}${reference.verse !== undefined ? '#' + reference.verse : ''}]]`;
				else {
					let { chapter, verse } = reference;
					replacement = `${reference.book} ${chapter}:`
					do {
						replacement += `![[${reference.book} ${chapter}#${verse}]]\n`;
						if (verse < books[reference.book][chapter]) verse++;
						else {
							chapter++;
							verse = 1;
							replacement += `>\n> ${reference.book} ${chapter}\n`;
						}
					} while (chapter < reference.endChapter || (chapter == reference.endChapter && verse <= reference.endVerse));
				}
			}

			this.context.editor.replaceRange(replacement, this.context.start, this.context.end);
		} catch (err) {
			if (err instanceof SyntaxError) {
				console.error("Failed to parse query:", this.context.query, err);
			} else throw err;
		}

	}
}

class InstantLink implements PluginValue {
	constructor(private view: EditorView, private settings: PluginSettings) {}
	
	update(update: ViewUpdate) {
		if (!this.settings.enableInstantLinking || !update.docChanged) return;
		const head = update.state.selection.main.head;
		const line = update.state.doc.lineAt(head);

		// If cursor pos == start of a line, then it is a newline
		const textBefore = head != line.from
			? line.text.slice(0, head - line.from)
			: update.state.doc.lineAt(head - 1).text + '\n';
		
		const reference = parseBibleReference(
			textBefore,
			new RegExp(this.settings.instantLinkingChar + "((?:\\d )?[A-Za-z]+(?: [A-Za-z]+)*) ?(\\d+)(?: ?: ?(\\d+))?\\s"),
			new RegExp(this.settings.instantLinkingChar + "((?:\\d )?[A-Za-z]+(?: [A-Za-z]+)*) ?(\\d+) ?: ?(\\d+) ?[-–] ?(\\d+) ?(?: ?: ?(\\d+))?\\s$")
		);
		if (!reference || typeof reference === "string") return; // TODO? Possibly add error message if its invalid

		setTimeout(() => {
			this.view.dispatch({
			changes: {
				from: head - reference.text.length,
				to: head - 1,
				insert: generateLink(reference, this.settings)
			}
			});
		}, 0);
	}
}


function parseBibleReference(input: string, singleReferenceRegex: RegExp, multiReferenceRegex: RegExp): Reference | MultiReference | string | null {
	// MultiReference
	let match = input.match(multiReferenceRegex);
	if (match) {
		const [ text, book, chapterStr, verseStr, third, forth ] = match;
		const chapter = parseInt(chapterStr, 10);
		const verse = parseInt(verseStr, 10);

		let endChapter, endVerse;
		if (forth === undefined) {
			endChapter = chapter;
			endVerse = parseInt(third, 10);
		} else {
			endChapter = parseInt(third, 10);
			endVerse = parseInt(forth, 10);

			if (chapter > endChapter) return "The scriptural reference range isn't valid"
			if (chapter < endChapter) {
				if (!isValidReference(book, chapter, verse) || !isValidReference(book, endChapter, endVerse)) return "Invalid Scripture reference";
				return { text, book, chapter, verse, endChapter, endVerse };
			}
		}

		// chapter = endChapter
		if (verse >= endVerse) return "The scriptural reference range isn't valid";
		if (!isValidReference(book, chapter, verse) || !isValidReference(book, endChapter, endVerse)) return "Invalid Scripture reference";
		return { text, book, chapter, verse, endChapter, endVerse }
	} else {
		// Normal Reference
		match = input.match(singleReferenceRegex);
		if (!match) return null;
		
		const [ text, book, chapterStr, verseStr ] = match;
		const chapter = parseInt(chapterStr, 10);
		const verse = parseInt(verseStr, 10) || undefined;

		if (!isValidReference(book, chapter, verse)) return "Invalid Scripture reference";
		return { text, book, chapter, verse };
	}
}

function isValidReference(book: string, chapter: number, verse?: number) {
	if (!books[book]?.[chapter]) return false;
	return verse === undefined || 1 <= verse && verse <= books[book][chapter];
}


function generateLink(reference: Reference | MultiReference, settings: PluginSettings): string {
	const { book, chapter, verse, endVerse, endChapter } = reference as MultiReference;

	if (verse === undefined) 		 return `[[${book} ${chapter}]]`;
	else if (endVerse === undefined) return `[[${book} ${chapter}#${verse}|${settings.singleVerseFormat.replace(/\{(book|chapter|verse)\}/g, (_, value) => (reference as Record<string, any>)[value])}]]`;

	else {
		const format = chapter == endChapter ? settings.sameChapterMultiVerseFormat : settings.diffChapterMultiVerseFormat;
		const parts = [...settings.diffChapterMultiVerseFormat.matchAll(/\[\[(.*?)\]\]/g)];

		if (parts.length < 1) return format; // fallback

		const firstPart = parts[0][1]; // inside first [[...]]
		const lastPart = parts[1]?.[1]; // inside last [[...]]
		const middle = format.match(/\]\](.*)\[\[/)?.[1] || ""; // text between

		// Replace placeholders
		const replacePlaceholders = (template: string, reference: Reference) =>
			template.replace(/\{(book|chapter|verse|endChapter|endVerse)\}/g, (_, key) => (reference as Record<string, any>)[key]?.toString() ?? "");

		const firstText = replacePlaceholders(firstPart, reference);

		const lastText = lastPart ? replacePlaceholders(lastPart, reference) : "";

		return `[[${book} ${chapter}#${verse}|${firstText}]]${middle}[[${book} ${endChapter ?? chapter}#${endVerse}|${lastText}]]`;
	}
}