# Views

<!-- Written by scripts/build-reference.mjs from the manifests' view containers and views. Do not edit: run npm run build. -->

The view containers (an activity bar icon, a panel tab) and the views tools contribute, with the tool that owns each.

## View containers

| Id | Title | Owner | Location | Hidden |
|---|---|---|---|---|
| `agents-container` | Agents | agents | auxiliaryBar |  |
| `browser-container` | Browser | browser | sidebar |  |
| `budget-container` | Budget | budget | sidebar |  |
| `canvas-container` | Canvas | canvas | sidebar |  |
| `chat-container` | Chat | chat | auxiliaryBar |  |
| `conceptLab-container` | Concept Lab | concept-lab | sidebar |  |
| `text-generator-container` | Creations AI | creations-ai | sidebar |  |
| `dashboard-container` | Dashboard | dashboard | sidebar |  |
| `explorer-container` | Explorer | explorer | sidebar |  |
| `flashcards-container` | Flashcards | flashcards | sidebar |  |
| `media-organizer-container` | Atelier | media-organizer | sidebar |  |
| `planner-container` | Planner | planner | sidebar |  |
| `search-container` | Search | search | sidebar |  |
| `study-container` | Study | study | sidebar |  |
| `tools-container` | Tools | tool-gallery | sidebar |  |
| `worksheet-container` | Worksheets | worksheet | sidebar |  |

## Views

| Id | Name | Owner | Container | When |
|---|---|---|---|---|
| `view.activityLog` | Activity | activity-log | panel |  |
| `view.agents` | Agents | agents | agents-container |  |
| `browser.sidebar` | Browser | browser | browser-container |  |
| `budget.nav` | Budget | budget | budget-container |  |
| `view.canvas` | Pages | canvas | canvas-container |  |
| `view.chat` | Chat | chat | chat-container |  |
| `conceptLab.modules` | Modules | concept-lab | conceptLab-container |  |
| `textGenerator.home` | Creations AI | creations-ai | text-generator-container |  |
| `view.dashboard` | Dashboards | dashboard | dashboard-container |  |
| `view.diagnostics` | AI Diagnostics | diagnostics | panel |  |
| `view.explorer` | Explorer | explorer | explorer-container |  |
| `view.openEditors` | Open Editors | explorer | explorer-container |  |
| `flashcards.decks` | Decks | flashcards | flashcards-container |  |
| `view.indexingLog` | Indexing | indexing-log | panel |  |
| `mediaOrganizer.browser` | Atelier | media-organizer | media-organizer-container |  |
| `view.output` | Output | output | panel |  |
| `view.planner` | Tasks | planner | planner-container |  |
| `view.search` | Search | search | search-container |  |
| `study.materials` | Materials | study | study-container |  |
| `view.terminal` | Terminal | terminal | panel |  |
| `view.tools` | Installed Tools | tool-gallery | tools-container |  |
| `view.worksheet` | Practice Items | worksheet | worksheet-container |  |
| `view.workspaceGraph` | Workspace Graph | workspace-graph | view.explorer |  |
