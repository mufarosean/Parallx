# What to test from the Oct 29 run

Pull `dev`, rebuild, start the app on your usual workspace with Ollama
running. Most checks take a minute. The first section is the one that
matters most: it covers what could hurt daily use if it is wrong.

Each check says where, what to do, what you should see, and what to tell
me if it is not that.

---

## 1. First, the things that could hurt daily use

### 1.1 Your chats keep their history
- **Do:** Start the app. Open three or four older chats from the history
  list, including ones you have not opened in a while.
- **Expect:** Every chat shows all its messages.
- **Why:** Saving a chat changed. An unopened chat could lose its messages
  when only its title or model was saved. That is fixed, and saves now
  write only the messages that changed.
- **If wrong:** Tell me which chat, and roughly how long ago it was used.

### 1.2 A long chat still saves while the answer streams
- **Do:** In a chat, ask for something long (a summary of a paper). While
  it streams, wait for it to finish. Close the app, start it again, open
  that chat.
- **Expect:** The whole answer is there.

### 1.3 Auto context uses the model's full size from the first message
- **Do:** Set the chat's context to Auto (the size chip in the composer).
  Quit and restart the app. Send one message. In a terminal run
  `ollama ps`.
- **Expect:** The CONTEXT column shows your model's real size (or the size
  you set as the workspace default), not 8192.
- **If wrong:** Send me the `ollama ps` line.

### 1.4 Changing a setting does not change the chat's size
- **Do:** Pick a size for the chat (say 32K) on the chip. Open Settings and
  change something unrelated (font size). Send a message, then
  `ollama ps`.
- **Expect:** Still 32K.

### 1.5 Retrieval finds your material, and says nothing when there is nothing
- **Do:** In your Exam 7 workspace ask two questions:
  a) one your papers answer ("What does Clark say about the tail factor?");
  b) one they do not ("What is the capital of Peru?").
- **Expect:** a) the answer cites your papers, as before;
  b) no paper passages are pulled in (no sources from your papers).
- **If a) loses its sources:** the new relevance floor is too strict for
  your embedding model. Settings › AI › Retrieval › `retrieval.minRelevance`
  (default 0.5): try 0.4 and ask again, and tell me which value works.
- **If b) still pulls in papers:** try 0.6, and tell me.

### 1.6 Tools load when needed
- **Do:** In a chat with your usual tools on, ask for something outside the
  basics: "Add an event tomorrow at 3pm called Mock exam" (Planner on), or a
  Budget question.
- **Expect:** In the tool cards you see `tool_search` first, then the real
  tool (planner, budget…), and it is done.
- **If it says it cannot:** tell me the model and the exact ask. To compare,
  turn it off in Settings › AI › Tools › `tools.loadOnDemand` and ask again.

---

## 2. New things to try (AI features: need your model)

### 2.1 Lessons, with where they came from
- **Do:** In a chat: "Remember as a lesson: for Clark, always truncate the
  tail at 20 years." Approve the memory write.
- **Then:** Open Agents › Mind. Under **What it has written down** the
  lesson shows "From a chat on Oct 29, 2026".
- **Try Wrong** (thumbs-down) on it: it disappears from the list, and
  today's daily file in `.parallx/memory/` has a line saying you marked it
  wrong. The file itself moved to `.parallx/memory/_archive/lessons/`.
- **Open** (file icon) opens the lesson file. **Archive** puts it away.

### 2.2 Do Not Remember This
- **Do:** In a chat say something private ("My salary is 90k"). When it
  answers, right-click the answer's text and choose **Do Not Remember This**.
  Right-click again: it now says **Remember This** (to take it back).
- **Then:** Carry on the chat a few turns and ask it to remember something
  about you.
- **Expect:** Nothing about the marked exchange goes into USER.md, a lesson
  or today's daily file. The chat's summary is not written to memory at all.

### 2.3 Skills the AI drafts
- **Do:** After the AI does a multi-step task, say "Save how you did that as
  a skill."
- **Expect:** It calls `skill_draft` and says a draft is waiting. Agents ›
  Mind shows **Skills it has drafted** with the draft. The pencil opens it;
  **Add** makes it a real skill (it then shows in `.parallx/skills/`);
  the ✕ moves it to the trash.

### 2.4 A cut-off answer says so
- **Hard to force.** If you ever see an answer end with "The model ran out
  of room and stopped here", that is the new warning (it used to end
  silently mid-sentence). Tell me where you saw it.

### 2.5 Write tools never break a document
- **Do:** Ask the AI to "change cell B2 in <some workbook>.xlsx".
- **Expect:** It refuses to write into the .xlsx and offers a new .md or
  .csv file instead. Your workbook is unchanged.

---

## 3. Quick checks (no model needed)

### 3.1 Paste Markdown into a page
- **Do:** In claude.ai (or any chat) press the Copy button on an answer that
  has a heading, a list and a table. Paste into a canvas page.
- **Expect:** Real heading, list and table blocks, not `##` and `|` text.
- Pasting inside a code block still pastes plain text.

### 3.2 Links from the chat work in a page
- **Do:** Paste a citation link from a chat answer into a page (or paste
  `[Clark p.1](parallx://explorer/file?path=<a pdf>&page=1)`). Click it.
- **Expect:** The PDF opens at that page (it used to say "Only http links
  can be opened").
- **Backlinks:** a page that links to another with such a link now shows
  in that page's backlinks.

### 3.3 Find in Files searches PDFs, Word and Excel
- **Do:** Ctrl+Shift+F, search a phrase you know is in one of your papers.
- **Expect:** The PDF is listed, the match shows "p. N"; clicking opens the
  PDF at that page. A text file match opens at its line.
- **Note:** The first search over many PDFs is slower (each is read once);
  the next searches are fast. Tell me if the first one is too slow.

### 3.4 Flashcards: tables never scroll
- **Do:** Study a card whose answer or notes have a wide table (a Clark or
  Mack comparison).
- **Expect:** No horizontal scrollbar, no word split mid-word ("Cape Cod"
  whole). A very wide table is shrunk to fit.

### 3.5 Atelier masks: handles follow the drag
- **Do:** Open a photo in the image editor (or a Painting Plan's Photo
  step) › Masks › new Radial Gradient. Drag the oval's edge handles and its
  centre, with the mouse (and a finger or pen if you have one).
- **Expect:** The handle stays under the pointer the whole drag (it used to
  stop after a few pixels).

### 3.6 Planner event dialog
- **Do:** Planner › New Event.
- **Expect:** Starts and Ends rows line up; All day is on its own line under
  them; times show in full ("10:00 AM", not "10:00 …").

### 3.7 Routine editor
- **Do:** Agents › Routines › open a routine's steps (or Build Steps…).
- **Expect:** The graph fits the editor (not zoomed far out). An **On**
  switch in the header instead of Enable/Disable. Icon buttons: Preview
  Prompt, Delete Step.
- **Tidy Memory:** in Agents › Routines › "Or start from one of these" there
  is a new **Tidy Memory** template (installs off).

### 3.8 Small ones
- Welcome shows version 0.1.0, and its AI section has three plain rows (no
  `/init` or `.parallx/` rows).
- Buttons across Agents, Worksheets and Atelier now have icons. Tell me any
  icon that reads wrong.

---

## 4. If you only have ten minutes

1.1 (chats keep history), 1.3 (`ollama ps` after restart), 1.5 (two
questions), 1.6 (one planner ask), 3.1 (paste), 3.3 (search a paper).
