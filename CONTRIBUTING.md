# Contributing to BorraCord

First off, thanks for taking the time to contribute. 🎉

BorraCord is an open-source project, and we love to receive contributions from our community — you There are many ways to contribute, from writing tutorials or blog posts, improving the documentation, submitting bug reports and feature requests, or writing code which can be incorporated into BorraCord itself.

## 🐛 Reporting Bugs

A bug is a *demonstrable problem* that is caused by the code in the repository. Good bug reports are extremely helpful, but please:

1.  **Check existing issues** to see if the bug has already been reported.
2.  Use the **Bug Report Template** provided in the README.
3.  Include screenshots or console errors (F12) if possible.

## 💡 Feature Requests

If you have an idea for a new feature:

1.  Open a new Issue on GitHub.
2.  Describe the feature in detail.
3.  Explain *why* it would be useful.

## 🛠️ Development Setup

BorraCord is built with **Vanilla JavaScript** (Manifest V3), so you don't need `npm` or build tools.

1.  **Fork** and **Clone** the repository.
2.  Open Chrome/Edge/Brave and go to `chrome://extensions`.
3.  Enable **Developer Mode** (top right corner).
4.  Click **Load Unpacked**.
5.  Select the `BorraCord` folder.

**Tip:** Every time you make a change to `background.js` or `manifest.json`, you must click the **Reload** (🔄) icon on the extension card in `chrome://extensions`. Changes to `popup.html/css` usually update instantly when you reopen the popup.

## 🌍 Translating BorraCord (Easy & High Value)

We want BorraCord to be accessible to everyone. Adding a new language is one of the best ways to contribute!

To add a new language (e.g., Italian `it`):

1.  **Create the JSON file:**
    * Duplicate `lang/en.json`.
    * Rename it to `lang/it.json`.
    * Translate the values (keep the keys exactly the same!).

2.  **Update the Interface (`popup.html`):**
    * Find the `<ul class="lang-menu">` section.
    * Add your new language to the list:
        ```html
        <li data-lang="it"><span class="flag">🇮🇹</span> Italiano</li>
        ```

3.  **Update the Logic (`popup.js`):**
    * Add the flag mapping in the `loadLanguage` function:
        ```javascript
        const flagMap = { ..., 'it': '🇮🇹' };
        ```

## 📥 Pull Request Process

1.  Fork the repo and create your branch from `main`.
2.  If you've added code that should be tested, add tests (or screenshots of proof).
3.  Ensure the code style matches the existing project (clean, readable, no console logs left behind).
4.  Issue that Pull Request!

## 📜 License

By contributing, you agree that your contributions will be licensed under its MIT License.
