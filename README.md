# Obsidian Bible QuickLinker

This is a plugin that allows you to quickly link to local Bible verses based by typing a reference to a Bible verse or verses (like `Genesis 1:1-5`).

## Options

2-3 options are shown in the native editor suggestion dropdown.

1. Link verse/chapter - Generate Obsidian links to verses or chapters
    - _Example:_ `[[Genesis#1:1|Genesis 1:1]]`
2. Embed verse/chapter - Embed a single verse, multiple verses, or chapter in a block
    - _Example:_ `Exodus 1:1-2 → ![[Exodus 1#1]]![[Exodus 1#2]]`
3. Paste verse - Insert the the contents of a verse inline
    - _Example:_ `John 11:35 → Jesus wept`

## Manually installing the plugin

Copy over `main.js` and `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## How to use

- Clone this repo.
- Make sure your NodeJS is at least v16 (`node --version`).
- `npm i` or `yarn` to install dependencies.
- `npm run dev` to start compilation in watch mode.

## Inspiration

Based off the sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin

https://github.com/Floydv149/bibleLinkerPro/

https://github.com/tim-hub/obsidian-bible-reference/

https://github.com/kuchejak/obsidian-bible-linker-plugin/

https://github.com/jaanonim/obsidian-youversion-linker/