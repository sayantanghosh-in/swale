# Swale

A local-first command-line assistant for developers — track your TODOs, notes, and personal expenses from the terminal, with everything stored on your own machine.

[![npm version](https://img.shields.io/npm/v/swale.svg)](https://www.npmjs.com/package/swale)
[![license](https://img.shields.io/npm/l/swale.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/swale.svg)](https://nodejs.org)

---

## Contents

- [Why Swale](#why-swale)
- [Requirements](#requirements)
- [Installation](#installation)
- [Getting started](#getting-started)
- [Commands](#commands)
  - [`swale todo`](#swale-todo)
  - [`swale note`](#swale-note)
  - [`swale expense`](#swale-expense)
  - [Global options](#global-options)
- [Data storage](#data-storage)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)

---

## Why Swale

Swale keeps the small things a developer accumulates during a working day — a task, a thought, a receipt — in one place reachable from the terminal you already have open.

- **Local-first.** Everything lives in a single SQLite file on your machine. No account, no server, no sync, no telemetry.
- **Private by default.** Your notes and expenses never leave your computer.
- **Portable data.** One file. Copy it, back it up, move it between machines.
- **No runtime dependencies to install.** Swale uses Node's built-in SQLite support, so there is nothing to compile and no native modules to break.

---

## Requirements

|             |             |
| ----------- | ----------- |
| **Node.js** | 24 or later |

Swale relies on Node's built-in `node:sqlite` module, which is only available from Node 22.5 onward and is used here in its Node 24 form. Check your version with `node --version`.

---

## Installation

Install globally to get the `swale` command on your `PATH`:

```bash
npm install -g swale
```

Using another package manager:

```bash
pnpm add -g swale
yarn global add swale
```

Or run it without installing:

```bash
npx swale todo list
```

---

## Getting started

The first time you run any Swale command, you'll be asked to create a local profile:

```
$ swale todo list

Name: Ada Lovelace
Email: ada@example.com
Phone (with country code): +441234567890
? Select a currency: (Use arrow keys)
❯ INR
  USD
  EUR
  GBP
  Other

Ada Lovelace, you have been added successfully...
```

This happens once. The profile is stored locally alongside your data and is used to attribute records and to format expense amounts. Subsequent commands greet you and run immediately.

Add your first todo:

```bash
$ swale todo add
Enter todo: Review the authentication pull request
Todo added successfully! To view the entire list use `swale todo list`
```

---

## Commands

Swale is organised into three commands, one per record type. Each takes an **action** and, where relevant, the **ID** of a record.

```
swale <command> <action> [id]
```

Actions that create or modify a record prompt you for the details interactively rather than taking them as arguments.

Record IDs are UUIDs, shown in the output of every `list` and `read`. Copy the ID from there when using `read`, `update`, or `delete`.

### `swale todo`

Track tasks.

| Command                      | Description                                       |
| ---------------------------- | ------------------------------------------------- |
| `swale todo add`             | Prompts for the todo text and saves it            |
| `swale todo list`            | Lists all of your todos, newest activity first    |
| `swale todo read <todoId>`   | Shows a single todo in full                       |
| `swale todo update <todoId>` | Prompts for replacement text and updates the todo |
| `swale todo delete <todoId>` | Permanently deletes the todo                      |

```bash
$ swale todo list
ID: 6f3c2b1e-9a44-4d0f-8c21-7e5b90a1d2c8
pending | Created by: Ada Lovelace <ada@example.com> | Created: 5 minutes ago
> Review the authentication pull request
```

### `swale note`

Capture short pieces of text you want to keep.

| Command                      | Description                                       |
| ---------------------------- | ------------------------------------------------- |
| `swale note add`             | Prompts for the note text and saves it            |
| `swale note list`            | Lists all of your notes                           |
| `swale note read <noteId>`   | Shows a single note in full                       |
| `swale note update <noteId>` | Prompts for replacement text and updates the note |
| `swale note delete <noteId>` | Permanently deletes the note                      |

### `swale expense`

Record personal spending. Amounts are displayed in the currency chosen during setup.

| Command                            | Description                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `swale expense add`                | Prompts for a description and an amount                                           |
| `swale expense list`               | Lists all of your expenses                                                        |
| `swale expense filter`             | Prompts for text and lists expenses whose description matches, in full or in part |
| `swale expense read <expenseId>`   | Shows a single expense in full                                                    |
| `swale expense update <expenseId>` | Asks whether to change the amount, the description, or both                       |
| `swale expense delete <expenseId>` | Permanently deletes the expense                                                   |

```bash
$ swale expense add
What did you spend on? Team coffee
How much did you spend (default currency: INR)? 240
Expense added successfully! To view the entire list use `swale expense list`
```

Supported currencies: `INR`, `USD`, `EUR`, `GBP`, and `Other`. Choosing `Other` displays raw amounts without a currency symbol.

### Global options

| Option            | Description                                                     |
| ----------------- | --------------------------------------------------------------- |
| `-V`, `--version` | Print the installed version                                     |
| `-h`, `--help`    | Show help. Also available per command, e.g. `swale todo --help` |

---

## Data storage

Swale keeps all of your data in a single SQLite database named `data.db`, inside a directory it creates on first run.

| Platform    | Location                                                                             |
| ----------- | ------------------------------------------------------------------------------------ |
| **macOS**   | `~/.swale/data.db`                                                                   |
| **Linux**   | `~/.swale/data.db`                                                                   |
| **Windows** | `%APPDATA%\swale\data.db` — typically `C:\Users\<you>\AppData\Roaming\swale\data.db` |

> On Windows, in the unusual case that the `APPDATA` environment variable is not set, Swale falls
> back to `C:\Users\<you>\.swale\data.db`.

On macOS and Linux the directory is created with `0700` permissions, so only your user account can read it.

Because it's a single ordinary file, you can back Swale up by copying it, and you can inspect it with any SQLite client:

```bash
sqlite3 ~/.swale/data.db
sqlite> .mode box
sqlite> .tables
sqlite> SELECT * FROM todos;
```

---

## Configuration

### `SWALE_DATA_DIR`

Overrides the directory Swale uses for its database. Useful for keeping separate sets of data, or for trying commands without touching your real records:

```bash
SWALE_DATA_DIR=/tmp/swale-scratch swale todo add
```

The path is resolved relative to your current directory if it isn't absolute, and the directory is created if it doesn't exist.

---

## Contributing

Bug reports and feature requests are welcome at
[github.com/sayantanghosh-in/swale/issues](https://github.com/sayantanghosh-in/swale/issues).

To work on Swale locally:

```bash
git clone https://github.com/sayantanghosh-in/swale.git
cd swale
pnpm install

pnpm dev -- todo list     # run from source
pnpm typecheck            # check types
pnpm format               # format with Prettier
pnpm build                # compile to dist/
```

Set `SWALE_DATA_DIR` while developing so you don't write to your real database.

---

## License

[MIT](./LICENSE) © Sayantan Ghosh
