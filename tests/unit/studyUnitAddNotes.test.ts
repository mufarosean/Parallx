// Study: Add Notes or Files… run with no unit named (as from the command palette)
// asks which unit, then shows the picker of notes and files at once; it does not
// open the unit's tab and leave him to press Add again.
import { describe, it, expect, vi } from 'vitest';
import { studyHarness } from './fixtures/studyDoor';

const NAMES = ['__testables', '_stSubjects', 'stCreateSubject', 'stSubjectEnqueue', 'stSubjectFlush', 'stCmdAddNotesOrFiles'];

describe('Study: Add Notes or Files… with no unit named', () => {
  it('asks for the unit, then shows the picker, and opens no tab', async () => {
    const h = studyHarness(NAMES);
    const S = h.S;
    const settle = async () => { for (let i = 0; i < 4; i++) for (const st of [...S._stSubjects.values()]) await S.stSubjectEnqueue(st, () => S.stSubjectFlush(st)); };
    const bank = h.person.database('Q', [{ name: 'Model Answer', type: 'text' }], [{ title: 'q1', values: {} }]);
    const subject = await S.stCreateSubject({ name: 'Exam 7', questionsDb: bank.id });
    await settle();
    h.person.add(h.byTitle('Units'), 'Mack', {});
    await settle();

    const picks: any[] = [];
    const showQuickPick = vi.fn(async (items: any[], o: any) => { picks.push(o || {}); return o?.canPickMany ? [] : items[0]; });
    const openEditor = vi.fn(async () => {});
    h.api.window = { showQuickPick, showInformationMessage: vi.fn(), showWarningMessage: vi.fn() };
    h.api.editors = { openEditors: [], focusEditor: vi.fn(), openEditor };
    h.api.workspace.getCanvasPageTree = async () => [{ id: 'p1', title: 'Mack notes', children: [] }];
    h.api.workspace.listFiles = async () => [];

    vi.stubGlobal('document', { querySelectorAll: () => [] });
    try { await S.stCmdAddNotesOrFiles(subject.id); } finally { vi.unstubAllGlobals(); }

    expect(picks.some((o) => o.canPickMany)).toBe(true);
    expect(openEditor).not.toHaveBeenCalled();
  });
});
