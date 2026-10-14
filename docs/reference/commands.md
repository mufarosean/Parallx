# Commands

<!-- Written by scripts/build-reference.mjs from the command descriptors and the manifests. Do not edit: run npm run build. -->

Every command the app and its tools register, with the tool that owns it (`core` is the workbench). A when-clause says when the command is available.

| Id | Title | Owner | Category | Keybinding | When |
|---|---|---|---|---|---|
| `activityLog.copyRecent` | Activity: Copy Timeline to Clipboard | activity-log |  |  |  |
| `agents.newRoutine` | Agents: New Routine… | agents |  |  |  |
| `agents.openRun` | Agents: Watch Run | agents |  |  |  |
| `agents.show` | Agents: Show | agents |  |  |  |
| `agents.showHistory` | Agents: Show History | agents |  |  |  |
| `agents.showRoutines` | Agents: Show Routines | agents |  |  |  |
| `autonomyLog.clear` | Agents: Clear History | agents |  |  |  |
| `autonomyLog.markAllRead` | Agents: Mark History Read | agents |  |  |  |
| `workflows.new` | Workflows: New Workflow | agents |  |  |  |
| `workflows.openEditor` | Workflows: Open Editor | agents |  |  |  |
| `ai-settings.open` | Parallx: Open AI Settings | ai-settings |  |  |  |
| `memory.openDurable` | Parallx: Open Durable Memory | ai-settings |  |  |  |
| `memory.openTodayLog` | Parallx: Open Today's Memory Log | ai-settings |  |  |  |
| `browser.back` | Back | browser | Browser |  |  |
| `browser.bookmark` | Bookmark This Page | browser | Browser |  |  |
| `browser.clearAgentData` | Clear Assistant Browser Data | browser | Browser |  |  |
| `browser.clearData` | Clear Browsing Data | browser | Browser |  |  |
| `browser.find` | Find In Page | browser | Browser |  |  |
| `browser.focusAddress` | Focus Address Bar | browser | Browser |  |  |
| `browser.forward` | Forward | browser | Browser |  |  |
| `browser.newPrivateTab` | New Private Tab | browser | Browser |  |  |
| `browser.newTab` | New Tab | browser | Browser |  |  |
| `browser.openBookmarks` | Bookmarks | browser | Browser |  |  |
| `browser.openHistory` | History | browser | Browser |  |  |
| `browser.openShields` | Blocked Trackers | browser | Browser |  |  |
| `browser.openUrl` | Open Address | browser | Browser |  |  |
| `browser.refreshLists` | Refresh Filter Lists | browser | Browser |  |  |
| `browser.reload` | Reload | browser | Browser |  |  |
| `browser.sendToChat` | Send Page To Chat | browser | Browser |  |  |
| `browser.toggleReader` | Reader Mode | browser | Browser |  |  |
| `browser.zoomIn` | Zoom In | browser | Browser |  |  |
| `browser.zoomOut` | Zoom Out | browser | Browser |  |  |
| `browser.zoomReset` | Reset Zoom | browser | Browser |  |  |
| `budget.exportCsv` | Export Transactions to CSV | budget | Budget |  |  |
| `budget.importCsv` | Import Transactions from CSV | budget | Budget |  |  |
| `budget.openAccounts` | Open Net Worth and Goals | budget | Budget |  |  |
| `budget.openCashFlow` | Open Trends | budget | Budget |  |  |
| `budget.openCategories` | Open Categories | budget | Budget |  |  |
| `budget.openDashboard` | Open Overview | budget | Budget |  |  |
| `budget.openImportExport` | Open Import / Export | budget | Budget |  |  |
| `budget.openPlan` | Open Plan | budget | Budget |  |  |
| `budget.openReconcile` | Open Reconcile | budget | Budget |  |  |
| `budget.openRecurring` | Open Bills | budget | Budget |  |  |
| `budget.openReviewQueue` | Open Review | budget | Budget |  |  |
| `budget.openRules` | Open Merchants and Rules | budget | Budget |  |  |
| `budget.openSettings` | Open Budget Settings | budget | Budget |  |  |
| `budget.openSyncLog` | Open Sync Log | budget | Budget |  |  |
| `budget.openTransactions` | Open Transactions | budget | Budget |  |  |
| `budget.reprocessHistory` | Reprocess History… | budget | Budget |  |  |
| `budget.sync` | Sync Now | budget | Budget |  |  |
| `canvas.deletePage` | Canvas: Delete Page | canvas |  |  |  |
| `canvas.duplicatePage` | Canvas: Duplicate Page | canvas |  |  |  |
| `canvas.manageTemplates` | Canvas: Manage Templates | canvas |  |  |  |
| `canvas.newDatabase` | Canvas: New Database | canvas |  |  |  |
| `canvas.newPage` | Canvas: New Page | canvas |  |  |  |
| `canvas.renamePage` | Canvas: Rename Page | canvas |  |  |  |
| `canvas.saveAsTemplate` | Canvas: Save Page As Template | canvas |  |  |  |
| `canvas.showKeyboardShortcuts` | Canvas: Show Keyboard Shortcuts | canvas |  |  |  |
| `canvas.showTemplatePicker` | Canvas: Show Template Picker | canvas |  |  |  |
| `chat.clearPlan` | Chat: Clear Plan | chat |  |  |  |
| `chat.clearSession` | Chat: Clear Session | chat |  |  |  |
| `chat.focus` | Chat: Focus Input | chat |  |  |  |
| `chat.newSession` | Chat: New Session | chat |  |  |  |
| `chat.show` | Chat: Show | chat |  |  |  |
| `chat.stop` | Chat: Stop Response | chat |  |  |  |
| `chat.toggle` | Chat: Toggle Chat Panel | chat |  |  |  |
| `conceptLab.open` | Open Concept Lab | concept-lab | Concept Lab |  |  |
| `edit.copy` | Copy | core | Edit | Ctrl+C |  |
| `edit.cut` | Cut | core | Edit | Ctrl+X |  |
| `edit.find` | Find | core | Edit | Ctrl+F |  |
| `edit.paste` | Paste | core | Edit | Ctrl+V |  |
| `edit.redo` | Redo | core | Edit | Ctrl+Shift+Z |  |
| `edit.replace` | Replace | core | Edit | Ctrl+H |  |
| `edit.undo` | Undo | core | Edit | Ctrl+Z |  |
| `editor.addSelectionToChat` | Add Selection to Chat | core | AI |  |  |
| `editor.changeEncoding` | Change File Encoding | core | Editor |  |  |
| `editor.toggleWordWrap` | Toggle Word Wrap | core | View | Alt+Z |  |
| `file.newTextFile` | New Text File | core | File | Ctrl+N |  |
| `file.openFile` | Open File… | core | File | Ctrl+O |  |
| `file.revert` | Revert File | core | File |  |  |
| `file.save` | Save | core | File | Ctrl+S | activeEditor |
| `file.saveAll` | Save All | core | File | Ctrl+K S |  |
| `file.saveAs` | Save As… | core | File | Ctrl+Shift+S |  |
| `layout.moveAuxBarLeft` | Move Secondary Sidebar To Left Edge | core | Layout |  |  |
| `layout.moveAuxBarRight` | Move Secondary Sidebar To Right Edge | core | Layout |  |  |
| `layout.movePanelBottom` | Move Panel To Bottom Edge | core | Layout |  |  |
| `layout.movePanelLeft` | Move Panel To Left Edge | core | Layout |  |  |
| `layout.movePanelRight` | Move Panel To Right Edge | core | Layout |  |  |
| `layout.moveSidebarLeft` | Move Primary Sidebar To Left Edge | core | Layout |  |  |
| `layout.moveSidebarRight` | Move Primary Sidebar To Right Edge | core | Layout |  |  |
| `layout.reset` | Reset Layout to Defaults | core | Layout |  |  |
| `layout.resetAuxBarPosition` | Reset Secondary Sidebar To Default Position | core | Layout |  |  |
| `layout.resetPanelPosition` | Reset Panel To Default Position | core | Layout |  |  |
| `layout.resetSidebarPosition` | Reset Primary Sidebar To Default Position | core | Layout |  |  |
| `markdown.showPreview` | Markdown: Open Preview | core | Markdown |  |  |
| `markdown.showPreviewToSide` | Markdown: Open Preview to the Side | core | Markdown | Ctrl+K V |  |
| `parallx.installDocling` | Install Docling | core | Parallx |  |  |
| `part.resize` | Resize Part | core | Layout |  |  |
| `questions.getRegistry` | Get Question Providers | core | Questions |  |  |
| `view.moveToPanel` | Move View to Panel | core | View |  |  |
| `view.moveToSidebar` | Move View to Sidebar | core | View |  |  |
| `workbench.action.addWidget` | Add Widget to Workbench | core | View |  |  |
| `workbench.action.adoptWidget` | Move Widget to Workbench | core | View |  |  |
| `workbench.action.applyLayout` | Apply Saved Layout | core | View |  |  |
| `workbench.action.closeActiveEditor` | Close Editor | core | Editor | Ctrl+W |  |
| `workbench.action.closeWindow` | Close Window | core | Window |  |  |
| `workbench.action.container.dock` | Dock Container to Rail | core | View |  |  |
| `workbench.action.container.float` | Float Container | core | View |  |  |
| `workbench.action.container.moveToEdge` | Move Container to Edge | core | View |  |  |
| `workbench.action.decreaseTextSize` | Decrease Text Size | core | View | Ctrl+- |  |
| `workbench.action.decreaseViewHeight` | View: Make Focused Area Shorter | core | View | Ctrl+Alt+Shift+ArrowDown |  |
| `workbench.action.decreaseViewWidth` | View: Make Focused Area Narrower | core | View | Ctrl+Alt+Shift+ArrowLeft |  |
| `workbench.action.deleteLayout` | Delete Saved Layout | core | View |  |  |
| `workbench.action.focusActivityBar` | Focus Activity Bar | core | View |  |  |
| `workbench.action.focusFirstEditorGroup` | Focus First Editor Group | core | View | Ctrl+1 |  |
| `workbench.action.focusNextPart` | Focus Next Part | core | View | F6 |  |
| `workbench.action.focusPanel` | Focus into Panel | core | View | Ctrl+` |  |
| `workbench.action.focusPreviousPart` | Focus Previous Part | core | View | Shift+F6 |  |
| `workbench.action.focusSecondEditorGroup` | Focus Second Editor Group | core | View | Ctrl+2 |  |
| `workbench.action.focusSideBar` | Focus into Primary Side Bar | core | View | Ctrl+0 |  |
| `workbench.action.focusStatusBar` | Focus Status Bar | core | View |  |  |
| `workbench.action.focusThirdEditorGroup` | Focus Third Editor Group | core | View | Ctrl+3 |  |
| `workbench.action.gotoLine` | Go to Line/Column… | core | Go | Ctrl+G |  |
| `workbench.action.increaseTextSize` | Increase Text Size | core | View | Ctrl+= |  |
| `workbench.action.increaseViewHeight` | View: Make Focused Area Taller | core | View | Ctrl+Alt+Shift+ArrowUp |  |
| `workbench.action.increaseViewWidth` | View: Make Focused Area Wider | core | View | Ctrl+Alt+Shift+ArrowRight |  |
| `workbench.action.minimizeWindow` | Minimize Window | core | Window |  |  |
| `workbench.action.moveEditorToNextGroup` | Move Editor to Next Group | core | Editor |  |  |
| `workbench.action.moveEditorToPreviousGroup` | Move Editor to Previous Group | core | Editor |  |  |
| `workbench.action.movePartBeside` | Move Part Beside Another | core | View |  |  |
| `workbench.action.movePartToEdge` | Move Part to Edge | core | View |  |  |
| `workbench.action.nextEditor` | Open Next Editor | core | Editor | Ctrl+PageDown |  |
| `workbench.action.openKeybindings` | Open Keyboard Shortcuts | core | Preferences | Ctrl+K Ctrl+S |  |
| `workbench.action.openSettings` | Open Settings | core | Preferences |  |  |
| `workbench.action.previousEditor` | Open Previous Editor | core | Editor | Ctrl+PageUp |  |
| `workbench.action.quickOpen` | Go to File… | core | View | Ctrl+P |  |
| `workbench.action.renameLayout` | Rename Saved Layout | core | View |  |  |
| `workbench.action.resetPartPlacement` | Reset Part Placement | core | View |  |  |
| `workbench.action.resetTextSize` | Reset Text Size | core | View | Ctrl+Numpad0 |  |
| `workbench.action.saveLayout` | Save Current Layout | core | View |  |  |
| `workbench.action.selectTheme` | Color Theme… | core | Preferences |  |  |
| `workbench.action.showCommands` | Show All Commands | core | View | Ctrl+Shift+P |  |
| `workbench.action.splitEditor` | Split Editor Right | core | Editor | Ctrl+\ |  |
| `workbench.action.splitEditorOrthogonal` | Split Editor Down | core | Editor |  |  |
| `workbench.action.toggleAuxiliaryBar` | Toggle Right Area | core | View |  |  |
| `workbench.action.toggleMaximizedPanel` | Toggle Maximized Panel | core | View |  |  |
| `workbench.action.toggleMaximizeWindow` | Maximize or Restore Window | core | Window |  |  |
| `workbench.action.togglePanel` | Toggle Bottom Area | core | View | Ctrl+J |  |
| `workbench.action.toggleSidebar` | Toggle Left Area | core | View | Ctrl+B |  |
| `workbench.action.toggleStatusbarVisibility` | Toggle Status Bar Visibility | core | View |  |  |
| `workbench.action.toggleZenMode` | Toggle Zen Mode | core | View | Ctrl+K Z |  |
| `workbench.action.widget.editAppearance` | Edit Widget Appearance | core | View |  |  |
| `workbench.action.widget.moveToEdge` | Move Widget to Edge | core | View |  |  |
| `workbench.action.widget.openSettings` | Widget Settings | core | View |  |  |
| `workbench.action.widget.refresh` | Refresh Widget | core | View |  |  |
| `workbench.action.widget.remove` | Remove Widget | core | View |  |  |
| `workbench.action.widget.returnToDashboard` | Return Widget to Dashboard | core | View |  |  |
| `workbench.action.widget.setContentAlign` | Align Widget Content | core | View |  |  |
| `workbench.view.explorer` | Explorer: Show Explorer | core | View |  |  |
| `workbench.view.search` | Search: Show Search | core | View |  |  |
| `workbench.view.show` | View: Show View | core | View |  |  |
| `workspace.addFolderToWorkspace` | Add Folder to Workspace… | core | Workspace |  |  |
| `workspace.closeFolder` | Close Folder | core | Workspace | Ctrl+K Ctrl+F |  |
| `workspace.closeWindow` | Close Window | core | Workspace | Alt+F4 |  |
| `workspace.duplicateWorkspace` | Duplicate Workspace | core | Workspace |  |  |
| `workspace.exportToFile` | Save Workspace to File… | core | Workspace |  |  |
| `workspace.importFromFile` | Open Workspace from File… | core | Workspace |  |  |
| `workspace.openFolder` | Open Folder… | core | Workspace |  |  |
| `workspace.openRecent` | Open Recent Workspace… | core | Workspace |  |  |
| `workspace.removeFolderFromWorkspace` | Remove Folder from Workspace | core | Workspace |  |  |
| `workspace.rename` | Rename Workspace… | core | Workspace |  |  |
| `workspace.save` | Save Workspace | core | Workspace | Ctrl+S |  |
| `workspace.saveAs` | Save Workspace As… | core | Workspace |  |  |
| `workspace.switch` | Switch Workspace | core | Workspace |  |  |
| `textGenerator.newCharacter` | New Character | creations-ai | Creations AI |  |  |
| `textGenerator.newChat` | New Chat | creations-ai | Creations AI |  |  |
| `textGenerator.newStory` | New Story | creations-ai | Creations AI |  |  |
| `textGenerator.newTable` | New Table | creations-ai | Creations AI |  |  |
| `textGenerator.openCharacters` | Characters | creations-ai | Creations AI |  |  |
| `textGenerator.openHome` | Home | creations-ai | Creations AI |  |  |
| `textGenerator.openSettings` | Settings | creations-ai | Creations AI |  |  |
| `textGenerator.openStories` | Stories | creations-ai | Creations AI |  |  |
| `textGenerator.openTables` | Tables | creations-ai | Creations AI |  |  |
| `dashboard.addWidget` | Dashboard: Add Widget… | dashboard |  |  |  |
| `dashboard.newPage` | Dashboard: New Page | dashboard |  |  |  |
| `dashboard.open` | Dashboard: Open | dashboard |  |  |  |
| `dashboard.refreshAll` | Dashboard: Refresh All Widgets | dashboard |  |  |  |
| `diagnostics.runChecks` | Diagnostics: Run Health Checks | diagnostics |  |  |  |
| `explorer.addToChat` | Explorer: Add to Chat | explorer |  |  |  |
| `explorer.collapse` | Explorer: Collapse All | explorer |  |  |  |
| `explorer.copy` | Explorer: Copy | explorer |  |  |  |
| `explorer.copyPath` | Explorer: Copy Path | explorer |  |  |  |
| `explorer.copyRelativePath` | Explorer: Copy Relative Path | explorer |  |  |  |
| `explorer.cut` | Explorer: Cut | explorer |  |  |  |
| `explorer.delete` | Explorer: Delete | explorer |  |  |  |
| `explorer.newFile` | Explorer: New File… | explorer |  |  |  |
| `explorer.newFolder` | Explorer: New Folder… | explorer |  |  |  |
| `explorer.open` | Explorer: Open | explorer |  |  |  |
| `explorer.openToSide` | Explorer: Open to the Side | explorer |  |  |  |
| `explorer.paste` | Explorer: Paste | explorer |  |  |  |
| `explorer.refresh` | Explorer: Refresh | explorer |  |  |  |
| `explorer.rename` | Explorer: Rename… | explorer |  |  |  |
| `explorer.revealInExplorer` | Explorer: Reveal in Explorer | explorer |  |  |  |
| `explorer.revealInFileExplorer` | Explorer: Reveal in File Explorer | explorer |  |  |  |
| `explorer.toggleHiddenFiles` | Explorer: Toggle Hidden Files | explorer |  |  |  |
| `flashcards.addCards` | Add Cards | flashcards | Flashcards |  |  |
| `flashcards.customStudy` | Custom Study (Work Ahead) | flashcards | Flashcards |  |  |
| `flashcards.generate` | Generate Cards from Source (AI) | flashcards | Flashcards |  |  |
| `flashcards.newCard` | New Card | flashcards | Flashcards |  |  |
| `flashcards.newDeck` | New Deck | flashcards | Flashcards |  |  |
| `flashcards.open` | Open Flashcards | flashcards | Flashcards |  |  |
| `flashcards.reclassifyByType` | Typed Answers for Concept and List Cards | flashcards | Flashcards |  |  |
| `flashcards.stats` | Show Progress & Stats | flashcards | Flashcards |  |  |
| `flashcards.study` | Study Due Cards | flashcards | Flashcards |  |  |
| `flashcards.studyTag` | Study One Tag | flashcards | Flashcards |  |  |
| `indexingLog.clear` | Indexing: Clear Log | indexing-log |  |  |  |
| `indexingLog.toggleErrorFilter` | Indexing: Toggle Error Filter | indexing-log |  |  |  |
| `media-organizer.buildPHashes` | Build Perceptual Hashes (find near-duplicates) | media-organizer | Atelier |  |  |
| `media-organizer.cacheStats` | Show Thumbnail Cache Stats | media-organizer | Atelier |  |  |
| `media-organizer.cancelScan` | Cancel Scan | media-organizer | Atelier |  |  |
| `media-organizer.cleanThumbnails` | Clean Orphan Thumbnails | media-organizer | Atelier |  |  |
| `media-organizer.createAlbum` | Create Album | media-organizer | Atelier |  |  |
| `media-organizer.dailyStudy` | Daily Study | media-organizer | Atelier |  |  |
| `media-organizer.editImage` | Edit Image | media-organizer | Atelier |  |  |
| `media-organizer.emptyTrash` | Empty Trash | media-organizer | Atelier |  |  |
| `media-organizer.findDuplicates` | Find Duplicates | media-organizer | Atelier |  |  |
| `media-organizer.generateThumbnails` | Generate Thumbnails | media-organizer | Atelier |  |  |
| `media-organizer.importFiles` | Import Files… | media-organizer | Atelier |  |  |
| `media-organizer.moveToTrash` | Move Selected to Trash | media-organizer | Atelier |  |  |
| `media-organizer.newClipProject` | New Clip Project… | media-organizer | Atelier |  |  |
| `media-organizer.openClipEditor` | Open Clip Editor | media-organizer | Atelier |  |  |
| `media-organizer.openClipProject` | Open Clip Project… | media-organizer | Atelier |  |  |
| `media-organizer.openGrid` | Open Library | media-organizer | Atelier |  |  |
| `media-organizer.openSmartAlbum` | Open Smart Album | media-organizer | Atelier |  |  |
| `media-organizer.openTagReview` | Open Tag Review | media-organizer | Atelier |  |  |
| `media-organizer.paintingPlans` | Painting Plans | media-organizer | Atelier |  |  |
| `media-organizer.pasteEdit` | Paste Edit Onto Selected Photos | media-organizer | Atelier |  |  |
| `media-organizer.planPainting` | Plan Painting | media-organizer | Atelier |  |  |
| `media-organizer.practiceSession` | Practice Session | media-organizer | Atelier |  |  |
| `media-organizer.rebuildSearchIndex` | Rebuild Search Index | media-organizer | Atelier |  |  |
| `media-organizer.recordGif` | Record Screen… | media-organizer | Atelier |  |  |
| `media-organizer.removeFromOthers` | Remove Marks From Other Photos | media-organizer | Atelier |  |  |
| `media-organizer.removeFromSelected` | Remove Marks From Selected Photos | media-organizer | Atelier |  |  |
| `media-organizer.rescan` | Rescan Library | media-organizer | Atelier |  |  |
| `media-organizer.revealInMO` | Reveal in Atelier | media-organizer | Atelier |  |  |
| `media-organizer.saveSmartAlbum` | Save Current Search as Smart Album | media-organizer | Atelier |  |  |
| `media-organizer.scan` | Scan Directory | media-organizer | Atelier |  |  |
| `media-organizer.showShortcuts` | Keyboard Shortcuts | media-organizer | Atelier |  |  |
| `media-organizer.upscaleSetup` | Set Up The Upscaler | media-organizer | Atelier |  |  |
| `output.clear` | Output: Clear Log | output |  |  |  |
| `output.toggleTimestamps` | Output: Toggle Timestamps | output |  |  |  |
| `planner.newEvent` | Planner: New Event… | planner |  |  |  |
| `planner.newTask` | Planner: New Task… | planner |  |  |  |
| `planner.open` | Planner: Open | planner |  |  |  |
| `search.clearResults` | Search: Clear Results | search |  |  |  |
| `search.collapseAll` | Search: Collapse All Results | search |  |  |  |
| `search.expandAll` | Search: Expand All Results | search |  |  |  |
| `search.findInFiles` | Search: Find in Files | search |  |  |  |
| `settings.open` | Parallx: Open Settings | settings |  |  |  |
| `workspace.exportConfig` | Workspace: Export Configuration | settings |  |  |  |
| `workspace.importConfig` | Workspace: Import Configuration | settings |  |  |  |
| `workspace.resetConfig` | Workspace: Reset Configuration | settings |  |  |  |
| `study.addMaterial` | Add Material… | study | Study |  |  |
| `study.importQuestions` | Import Questions… | study | Study |  |  |
| `study.importReport` | Import Examiner's Report… | study | Study |  |  |
| `study.open` | Open Study | study | Study |  |  |
| `study.quizSelection` | Quiz This Selection | study | Study |  |  |
| `study.studyDocument` | Study This Document… | study | Study |  |  |
| `study.studyTogether` | Study Materials Together… | study | Study |  |  |
| `study.weakSpots` | Study Weak Spots | study | Study |  |  |
| `terminal.clear` | Terminal: Clear | terminal |  |  |  |
| `terminal.restart` | Terminal: Restart Shell | terminal |  |  |  |
| `theme-editor.open` | Parallx: Appearance | theme-editor |  |  |  |
| `tools.showInstalled` | Tools: Show Installed Tools | tool-gallery |  |  |  |
| `welcome.openWelcome` | Welcome: Show Welcome Page | welcome |  |  |  |
| `worksheet.bank` | Worksheets: Open Problem Bank | worksheet |  |  |  |
| `worksheet.dashboard` | Worksheets: Open Dashboard | worksheet |  |  |  |
| `worksheet.generate` | Worksheets: Generate Items | worksheet |  |  |  |
| `worksheet.generateFromFile` | Worksheets: Generate Items From a File… | worksheet |  |  |  |
| `worksheet.importExcel` | Worksheets: Import from Excel | worksheet |  |  |  |
| `worksheet.importPlan` | Worksheets: Import Plan… | worksheet |  |  |  |
| `worksheet.open` | Worksheets: Open Practice Items | worksheet |  |  |  |
| `worksheet.openScratch` | Worksheets: Open Scratch Sheet | worksheet |  |  |  |
| `worksheet.plan` | Worksheets: Open Campaign | worksheet |  |  |  |
| `worksheet.practice` | Worksheets: Start Practice Session | worksheet |  |  |  |
| `worksheet.quizzes` | Worksheets: Open Quizzes | worksheet |  |  |  |
| `worksheet.settings` | Worksheets: Settings | worksheet |  |  |  |
| `workspaceGraph.open` | Open Full Graph | workspace-graph | Workspace Graph |  |  |
| `workspaceGraph.rebuildConceptualLinks` | Rebuild Conceptual Links | workspace-graph | Workspace Graph |  |  |
| `workspaceGraph.refresh` | Refresh | workspace-graph | Workspace Graph |  |  |
