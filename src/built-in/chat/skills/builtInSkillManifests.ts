/**
 * Built-in skill manifests — shipped with Parallx, not discovered from workspace.
 *
 * These skills are available in every workspace regardless of whether
 * `.parallx/skills/` exists. Workspace skills with the same name override
 * these built-in versions.
 *
 * Per M11: "Built-in skills ship with Parallx; workspace skills live in
 * `.parallx/skills/`."
 */

import type { ISkillManifest } from '../../../services/skillLoaderService.js';

export const builtInSkillManifests: readonly ISkillManifest[] = [
  {
    name: 'folder-overview',
    description: 'Provide a structural overview of a folder\'s contents including file count, file types, folder hierarchy, and brief descriptions of each file\'s purpose. Focuses on organization rather than deep content.',
    version: '1.0.0',
    author: 'parallx',
    kind: 'workflow',
    permission: 'always-allowed',
    userInvocable: true,
    disableModelInvocation: false,
    tags: ['workflow', 'overview', 'structural'],
    relativePath: '(built-in)/skills/folder-overview/SKILL.md',
    parameters: [
      { name: 'folder', type: 'string', description: 'Folder path to overview, or empty for workspace root', required: false },
    ],
    body: `# Folder Overview Workflow

You are executing the **folder-overview** skill. Follow these steps
precisely.

## Step 1: Enumerate the folder

Use \`list_files\` to list all files and subfolders in the target folder
($ARGUMENTS or the workspace root if no folder is specified).

Record:
- Total file count
- Subfolder names
- File names with extensions

## Step 2: Classify files

For each file, determine:
- **Type**: based on extension (.md = markdown, .json = config, .pdf = document, etc.)
- **Size category**: stub (< 3 lines), small, medium, large (estimated from content)
- **Purpose**: brief description based on filename and a quick read

Use \`read_file\` to read the first ~20 lines of each file to understand its purpose.
For very short files, read the entire content.

## Step 3: Build the overview

Present the overview in this structure:

1. **Folder**: Name and path
2. **Contents**: Total files, total subfolders
3. **File listing**: Table or list with:
   - File name
   - Type/extension
   - Brief description (1 sentence)
4. **Subfolders**: For each subfolder, recurse and list its contents
   (one level deep is sufficient unless the user specified otherwise)

## Step 4: Note any issues

Flag any notable patterns:
- Empty or stub files
- Duplicate filenames in different subfolders
- Inconsistent naming conventions
- Files that appear to be drafts or incomplete`,
  },
  {
    name: 'scoped-extraction',
    description: 'Extract specific information from all files in a scope. Reads every file in the target folder or workspace, extracts the requested facts or values, and aggregates them into a structured result. Ensures exhaustive coverage across all files.',
    version: '1.0.0',
    author: 'parallx',
    kind: 'workflow',
    permission: 'always-allowed',
    userInvocable: true,
    disableModelInvocation: false,
    tags: ['workflow', 'extraction', 'exhaustive'],
    relativePath: '(built-in)/skills/scoped-extraction/SKILL.md',
    parameters: [
      { name: 'query', type: 'string', description: 'What information to extract and from which scope', required: true },
    ],
    body: `# Scoped Extraction Workflow

You are executing the **scoped-extraction** skill. Follow these steps
precisely. Do not skip files \u2014 every file in scope must be checked.

## Step 1: Parse the extraction request

From $ARGUMENTS, determine:
- **What** to extract (e.g. "deductible amounts", "contact names", "dates")
- **Where** to look (specific folder, file type, or entire workspace)

If the scope is unclear, default to the entire workspace.

## Step 2: Enumerate files in scope

Use \`list_files\` to enumerate all files in the target scope.
Record the complete file list as your coverage checklist.

## Step 3: Read and extract from each file

For **every** file in the coverage checklist:

1. Use \`read_file\` to read the file's content.
2. Search for instances of the target information.
3. If found, record:
   - The extracted value(s)
   - The file path where it was found
   - The context (surrounding text, section heading)
4. If NOT found in this file, note: "No matching information in [file]"

Do NOT skip files. Even if you think a file is unlikely to contain the
target information, read it and check.

## Step 4: Aggregate results

Present the extracted information in a structured format:

1. **Extraction target**: What was searched for
2. **Scope**: What files/folders were searched
3. **Results**: Table or list with:
   - Value found
   - Source file (with path)
   - Context snippet
4. **Files with no matches**: List files that were checked but contained
   no relevant information
5. **Coverage**: "Checked X/Y files" (X must equal Y)

## Step 5: Identify conflicts

If the same type of information has different values in different files:
- Flag the conflict prominently
- Show both values with their source files
- Do not silently pick one value over another`,
  },
  {
    name: 'document-comparison',
    description: 'Compare two or more documents in detail. Reads each document fully, analyzes them across multiple dimensions (structure, content, claims, data), and produces a structured comparison highlighting similarities, differences, and contradictions.',
    version: '1.0.0',
    author: 'parallx',
    kind: 'workflow',
    permission: 'always-allowed',
    userInvocable: true,
    disableModelInvocation: false,
    tags: ['workflow', 'comparison', 'analysis'],
    relativePath: '(built-in)/skills/document-comparison/SKILL.md',
    parameters: [
      { name: 'targets', type: 'string', description: 'Names or paths of documents to compare', required: true },
    ],
    body: `# Document Comparison Workflow

You are executing the **document-comparison** skill. Follow these steps
precisely. Read every target document in full \u2014 do not compare from
summaries or memory.

## Step 1: Identify target documents

Parse $ARGUMENTS to determine which documents to compare.

- If specific filenames are given, use \`search_knowledge\` or \`list_files\`
  to locate them.
- If the user refers to documents by description (e.g. "the two policy
  files"), use \`list_files\` and \`search_knowledge\` to identify them.
- If the same filename exists in multiple folders, identify ALL instances
  and ask the user to clarify, or compare all instances.

Record the full paths of all documents to compare.

## Step 2: Read each document

Use \`read_file\` to read the **complete content** of each target document.
Do not truncate or skip sections.

For each document, note:
- File path
- Length (approximate line count)
- Structure (headings, sections, format)
- Key claims, numbers, and facts

## Step 3: Analyze dimensions

Compare the documents across these dimensions:

1. **Structure**: How are they organized? Same sections? Different format?
2. **Content overlap**: What topics do they share?
3. **Factual differences**: Where do they state different facts, numbers,
   or dates?
4. **Contradictions**: Where do they directly contradict each other?
   (Flag these prominently.)
5. **Unique content**: What exists in one document but not the other?

## Step 4: Synthesize comparison

Present the comparison in this structure:

1. **Documents compared**: List each with path and brief description
2. **Summary**: One paragraph overview of the relationship
3. **Key differences**: Bullet list of factual differences with specific
   values from each document
4. **Contradictions**: Highlighted section with exact conflicting claims,
   citing both sources
5. **Similarities**: Shared content and agreement
6. **Unique content**: What each document covers that the other doesn't`,
  },
  {
    name: 'exhaustive-summary',
    description: 'Summarize every file in a folder or the entire workspace. Reads each file individually and produces a per-file summary, then combines them into a comprehensive overview. Ensures no file is omitted.',
    version: '1.0.0',
    author: 'parallx',
    kind: 'workflow',
    permission: 'always-allowed',
    userInvocable: true,
    disableModelInvocation: false,
    tags: ['workflow', 'summary', 'exhaustive'],
    relativePath: '(built-in)/skills/exhaustive-summary/SKILL.md',
    parameters: [
      { name: 'scope', type: 'string', description: 'Folder path to summarize, or empty for entire workspace', required: false },
    ],
    body: `# Exhaustive Summary Workflow

You are executing the **exhaustive-summary** skill. Follow these steps
precisely. Do not skip any step. Do not summarize from memory \u2014 read every
file.

## Step 1: Enumerate all files

Use \`list_files\` to enumerate every file in the target scope ($ARGUMENTS or
the entire workspace root if no scope is specified).

- If the scope is a folder, list only that folder (recursively).
- If no scope is given, list the entire workspace root.
- Record the complete list of files. This is your **coverage checklist**.

## Step 2: Read each file

For **every** file in the coverage checklist:

1. Use \`read_file\` to read the file's full content.
2. Write a brief summary (2-4 sentences) of the file's content.
3. Note the file's relative path.

Do NOT skip files. Do NOT say a file is "too large to read." Every file
must be read and summarized.

If a file is very short (< 3 lines), note it as a stub and describe what
little content it has.

If a file contains irrelevant content (personal notes, off-topic material),
still summarize it but note that it appears unrelated to the workspace's
main topic.

## Step 3: Compile the summary

Present the summaries in a structured format:

1. **Overview**: One paragraph describing the workspace/folder's purpose
   based on what you read.
2. **File summaries**: A list of every file with:
   - File path (as a heading or bold text)
   - 2-4 sentence summary
   - Any notable characteristics (stub, draft, contradictions, etc.)
3. **Statistics**: Total file count, folder count, any notable patterns.

## Step 4: Verify coverage

Compare your summary list against the coverage checklist from Step 1.
If any file is missing from your summary, go back and read it now.

State: "Coverage: X/Y files summarized" where X = files you summarized and
Y = total files from Step 1. X must equal Y.`,
  },
  {
    name: 'git-status',
    description: 'Show the current Git status, recent commits, and uncommitted changes in the workspace. Uses terminal commands to gather repository state.',
    version: '1.0.0',
    author: 'parallx',
    kind: 'workflow',
    permission: 'always-allowed',
    userInvocable: true,
    disableModelInvocation: false,
    tags: ['workflow', 'git', 'version-control'],
    relativePath: '(built-in)/skills/git-status/SKILL.md',
    parameters: [
      { name: 'detail', type: 'string', description: 'Level of detail: "brief" for status only, "full" for status + log + diff', required: false },
    ],
    body: `# Git Status Workflow

You are executing the **git-status** skill. Follow these steps precisely.

## Step 1: Check repository status

Use \`run_command\` to run: \`git status --short\`

Record:
- Staged files (A/M/D)
- Unstaged changes
- Untracked files

## Step 2: Recent commits

Use \`run_command\` to run: \`git log --oneline -10\`

Record the last 10 commits with their short hashes and messages.

## Step 3: Current branch

Use \`run_command\` to run: \`git branch --show-current\`

Note the current branch name.

## Step 4: Show diff (if detail = "full")

If the user requested full detail or $ARGUMENTS contains "full":
Use \`run_command\` to run: \`git diff --stat\`

Show a summary of changed lines per file.

## Step 5: Present results

Format the output as:

1. **Branch**: Current branch name
2. **Status**: Modified/added/deleted/untracked files
3. **Recent commits**: Last 10 commits
4. **Changes** (if full): Diff stat summary`,
  },
  {
    name: 'fetch-url',
    description: 'Fetch the content of a URL and return it as text. Useful for reading web pages, API responses, or online documentation.',
    version: '1.0.0',
    author: 'parallx',
    kind: 'workflow',
    permission: 'requires-approval',
    userInvocable: true,
    disableModelInvocation: false,
    tags: ['workflow', 'web', 'fetch'],
    relativePath: '(built-in)/skills/fetch-url/SKILL.md',
    parameters: [
      { name: 'url', type: 'string', description: 'The URL to fetch', required: true },
    ],
    body: `# Fetch URL Workflow

You are executing the **fetch-url** skill. Follow these steps precisely.

## Step 1: Validate the URL

Check that $ARGUMENTS contains a valid URL starting with http:// or https://.
If the URL is missing or invalid, respond with an error message.

## Step 2: Fetch the content

Use \`run_command\` to run: \`curl -sL --max-time 15 "$URL"\`

Where $URL is the provided URL. The -sL flags silence progress output
and follow redirects. The --max-time flag prevents hanging.

## Step 3: Process the response

- If the content is HTML, extract the main text content (strip tags)
- If the content is JSON, format it readably
- If the content is plain text, return as-is
- If the fetch failed, report the error

## Step 4: Present results

Format the output as:

1. **URL**: The fetched URL
2. **Content type**: HTML / JSON / Plain text
3. **Content**: The extracted text (truncated to ~4000 characters if very long)`,
  },
  {
    name: 'pdf-extract',
    description: 'Extract text content from a PDF file using the Docling bridge. Returns the full text of the PDF for analysis or summarization.',
    version: '1.0.0',
    author: 'parallx',
    kind: 'workflow',
    permission: 'always-allowed',
    userInvocable: true,
    disableModelInvocation: false,
    tags: ['workflow', 'pdf', 'extraction', 'docling'],
    relativePath: '(built-in)/skills/pdf-extract/SKILL.md',
    parameters: [
      { name: 'file', type: 'string', description: 'Path to the PDF file to extract', required: true },
    ],
    body: `# PDF Extract Workflow

You are executing the **pdf-extract** skill. Follow these steps precisely.

## Step 1: Locate the PDF

Check that $ARGUMENTS contains a file path ending in .pdf.
Use \`list_files\` to verify the file exists at the given path.

If the path is ambiguous, use \`search_knowledge\` to find PDF files
matching the name.

## Step 2: Extract content

Use \`read_file\` on the PDF path. If the workspace has Docling integration,
this will automatically extract the text content through the document
extraction bridge.

## Step 3: Present results

Format the output as:

1. **File**: The PDF path
2. **Pages**: Number of pages (if available)
3. **Content**: The extracted text

If extraction fails (e.g., scanned image PDF without OCR), report the
limitation and suggest the user enable Docling OCR.`,
  },
];
