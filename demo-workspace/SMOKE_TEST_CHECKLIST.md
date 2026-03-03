# M12 Smoke Test Checklist

**Date:** March 3, 2026  
**Branch:** milestone-12  
**Prerequisites:**
- Ollama running with `qwen2.5:32b-instruct` loaded
- `nomic-embed-text` embedding model available
- Parallx built and running (`npm run dev` or `Parallx.bat`)

---

## Setup

1. Open Parallx
2. Open/create a workspace pointing to `demo-workspace/` folder
3. Wait for indexing to complete (check Output panel for "Indexing complete")
4. Open the Chat panel

---

## Test Scenarios

### Scenario 1: "The Fender Bender" (Situational — Planning Expected)

**Input:** `I got into a fender bender on the highway this morning`

**Expected:**
- [ ] Planning indicator appears ("Analyzing your situation..." or similar)
- [ ] Indicator transitions to retrieval phase ("Searching N sources...")
- [ ] Response includes collision coverage info ($50,000 limit, $500 deductible)
- [ ] Response includes claims filing steps or references Claims Guide
- [ ] Response includes agent contact info (Sarah Chen, phone number)
- [ ] Response includes what to document at the scene
- [ ] Response includes filing deadline (72 hours)
- [ ] "Thought process" expandable section shows planner reasoning + queries
- [ ] Context source pills reference multiple demo workspace documents

**Why it matters:** Proves the 2-call pipeline works — intent classification, multi-query expansion, proactive retrieval.

### Scenario 2: "Direct Question" (Short Query — Planning Skipped)

**Input:** `What's my deductible?`

**Expected:**
- [ ] NO planning indicator (should be skipped — short question with ?)
- [ ] Fast response with deductible amount ($500 collision, $250 comprehensive)
- [ ] Source references the Auto Insurance Policy document
- [ ] Response time noticeably faster than Scenario 1

**Why it matters:** Proves `shouldSkipPlanning()` works — no unnecessary latency for simple questions.

### Scenario 3: "Greeting" (Conversational — No RAG)

**Input:** `Hello`

**Expected:**
- [ ] NO planning indicator
- [ ] NO retrieval (no context pills)
- [ ] Simple conversational response
- [ ] Very fast response

**Why it matters:** Proves conversational messages skip both planning and retrieval.

### Scenario 4: "Follow-Up" (Conversational Context)

**After Scenario 1, input:** `What if the other driver was uninsured?`

**Expected:**
- [ ] Planning indicator appears (message is complex enough)
- [ ] Response references UM/UIM coverage ($100,000/$300,000 BI, $25,000 PD)
- [ ] Response notes the 24-hour police report requirement for UM claims
- [ ] Response connects to the original accident context from Scenario 1
- [ ] Different claims procedure for UM claims mentioned

**Why it matters:** Proves the planner uses conversation history for context.

### Scenario 5: "Exploration" (Discovery Intent)

**Input:** `What do I have in this workspace?`

**Expected:**
- [ ] Planning indicator may appear briefly
- [ ] Response summarizes workspace contents (policy, claims guide, contacts, vehicle info)
- [ ] May suggest follow-up questions or offer to summarize specific documents

**Why it matters:** Proves exploration intent handling.

### Scenario 6: "Empty Workspace Fallback" (Graceful Degradation)

**Setup:** Open a new empty workspace (no files, no pages)  
**Input:** `Tell me about my insurance coverage`

**Expected:**
- [ ] Planning is skipped (no indexed content available)
- [ ] Response acknowledges it has no workspace content to search
- [ ] No crashes, no error messages
- [ ] Graceful fallback to general response

**Why it matters:** Proves `shouldSkipPlanning()` handles empty workspace and the pipeline degrades gracefully.

---

## Edge Cases

- [ ] Multiple rapid messages: Does planning overlap or queue properly?
- [ ] Very long message (200+ words): Does planning handle it without timeout?
- [ ] Network interruption to Ollama during planning: Falls back to single-query?

---

## Results

| Scenario | Pass/Fail | Notes |
|----------|-----------|-------|
| 1. Fender Bender | | |
| 2. Direct Question | | |
| 3. Greeting | | |
| 4. Follow-Up | | |
| 5. Exploration | | |
| 6. Empty Workspace | | |

**Tested by:**  
**Date:**  
**Overall:**
