// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TIMER_WIDGET} from '../../src/built-in/dashboard/widgets/timerWidget.js';
import {DEFAULT_TIMER_CONFIG, parseState} from '../../src/built-in/dashboard/widgets/timerLogic.js';

describe('timer task budgets in the widget', () => {
  let host: HTMLElement;
  let saved: string | null;
  let handle: ReturnType<typeof TIMER_WIDGET.createWidget>;
  let changeConfig: (cfg: unknown) => void;
  const task = (id='a',budgetMinutes=27) => ({id,title:`Study ${id}`,est:1,act:0,done:false,createdAt:0,budgetMinutes,spentMinutes:0});
  const data = {listTasks:vi.fn(),listEvents:vi.fn(),updateTask:vi.fn()};
  const mount = (state = {tasks:[task()],activeTaskId:'a'} as unknown) => {
    host = document.createElement('div'); document.body.append(host);
    saved = JSON.stringify(state);
    handle = TIMER_WIDGET.createWidget(host, {
      config:{...DEFAULT_TIMER_CONFIG,alarm:'none',autoStartBreaks:true,autoStartFocus:true},cachedOutput:saved,
      api:{commands:{executeCommand:async()=>({data})}},
      setCachedOutput:(s:string)=>{saved=s;handle?.refreshFromCache?.(s)},
      onDidChangeConfig:(fn:typeof changeConfig)=>{changeConfig=fn;return{dispose(){}}},
    } as any);
  };
  const click = (label:string) => {
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === label);
    expect(button,`Button ${label}`).toBeTruthy(); button!.click();
  };
  beforeEach(()=>{
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T09:00:00'));
    data.listTasks.mockReset().mockResolvedValue([]); data.listEvents.mockReset();data.updateTask.mockReset();
  });
  afterEach(()=>{handle?.dispose();document.body.replaceChildren();vi.useRealTimers()});

  it('ends a shortened final break at the cap, persists it, and does not complete Planner',()=>{
    mount(); click('Start');vi.advanceTimersByTime(25*60000);
    expect(host.dataset.mode).toBe('short'); expect(host.querySelector('.dtimer__face')!.textContent).toBe('2:00');
    vi.advanceTimersByTime(2*60000);
    expect(parseState(saved).tasks[0].spentMinutes).toBe(27);
    expect(parseState(saved).endsAt).toBeNull();expect(parseState(saved).tasks[0].done).toBe(false);
    expect(host.querySelector('.dtimer__caption')!.textContent).toContain('Time budget reached');
    expect((host.querySelector('.dtimer__btn--primary') as HTMLButtonElement).disabled).toBe(true);
    expect(data.updateTask).not.toHaveBeenCalled();
    handle.dispose();host.remove();mount(JSON.parse(saved!));
    expect((host.querySelector('.dtimer__btn--primary') as HTMLButtonElement).disabled).toBe(true);
  });
  it('excludes pauses, freezes the running duration across settings changes, and credits a partial reset',()=>{
    mount();click('Start');vi.advanceTimersByTime(10*60000);click('Pause');
    vi.advanceTimersByTime(30*60000);
    changeConfig({...DEFAULT_TIMER_CONFIG,focusMinutes:50,alarm:'none'});
    expect(host.querySelector('.dtimer__face')!.textContent).toBe('15:00');
    click('Resume');vi.advanceTimersByTime(5*60000);click('Reset');
    expect(parseState(saved).tasks[0].spentMinutes).toBe(15);
    expect(host.querySelector('.dtimer__face')!.textContent).toBe('12:00');
  });
  it('credits elapsed time to the old task when switching and restores a paused short interval',()=>{
    mount({tasks:[task('a',10),task('b',60)],activeTaskId:'a'});
    click('Start');vi.advanceTimersByTime(2*60000);click('Study b');
    expect(parseState(saved).tasks.map(t=>t.spentMinutes)).toEqual([2,0]);
    click('Study a');click('Start');vi.advanceTimersByTime(60000);click('Pause');
    handle.dispose();host.remove();mount(JSON.parse(saved!));
    expect(host.querySelector('.dtimer__face')!.textContent).toBe('7:00');
    click('Resume');vi.advanceTimersByTime(7*60000);
    expect(parseState(saved).tasks[0].spentMinutes).toBe(10);
  });
  it('offers only explicit Planner task selections, including undated work, and keeps calendar history outside the queue',async()=>{
    data.listTasks.mockResolvedValue([{id:'tk',title:'Read Clark',status:'planned',dueAt:null}]);
    mount({tasks:[{...task('event'),sourceId:'ev',sourceKind:'event'}],activeTaskId:null});
    expect(host.querySelectorAll('.dtimer__task')).toHaveLength(0);
    click('Choose tasks');await vi.advanceTimersByTimeAsync(0);
    expect(data.listEvents).not.toHaveBeenCalled();expect(data.listTasks).toHaveBeenCalledWith({status:['planned','reviewing'],includeUndated:true});
    expect(host.querySelector('.dtimer__pickname')!.textContent).toBe('Read Clark');
    const checkbox = host.querySelector<HTMLInputElement>('.dtimer__pickrow input')!;
    expect(checkbox.checked).toBe(false);checkbox.click();click('Add Selected');await vi.advanceTimersByTimeAsync(0);
    expect(host.querySelectorAll('.dtimer__task')).toHaveLength(1);
    expect(parseState(saved).tasks).toHaveLength(2);
    expect(parseState(saved).tasks.find(t=>t.sourceId==='tk')!.budgetMinutes).toBe(60);
  });
  it('opens budget editing from the task time and hides it after saving or starting',()=>{
    mount();
    const editor=host.querySelector<HTMLElement>('.dtimer__budget')!;
    expect(editor.hidden).toBe(true);
    click('0/27 min');
    expect(editor.hidden).toBe(false);
    const input=host.querySelector<HTMLInputElement>('.dtimer__input--budget')!;
    input.value='120';input.dispatchEvent(new Event('input'));
    expect(host.querySelector('.dtimer__budgetpreview')!.textContent).toContain('100 min focus · 20 min breaks');
    host.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
    expect(parseState(saved).tasks[0].budgetMinutes).toBe(120);
    expect(editor.hidden).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Time budget for Study a');
    click('0/120 min');
    click('Start');vi.advanceTimersByTime(1000);
    expect(editor.hidden).toBe(true);
    expect(host.querySelector('.dtimer__input--budget')).toBe(input);expect(input.disabled).toBe(true);
  });
  it('cancels budget edits without saving and closes them when switching tasks',()=>{
    mount({tasks:[task(),task('b',60)],activeTaskId:'a'});
    click('0/27 min');
    const editor=host.querySelector<HTMLElement>('.dtimer__budget')!;
    const input=host.querySelector<HTMLInputElement>('.dtimer__input--budget')!;
    input.value='90';
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    expect(editor.hidden).toBe(true);
    expect(parseState(saved).tasks[0].budgetMinutes).toBe(27);
    click('0/27 min');expect(input.value).toBe('27');
    click('Study b');expect(editor.hidden).toBe(true);
  });
  it('does not charge an unassigned running timer to a newly added task',()=>{
    mount({tasks:[],activeTaskId:null});click('Start');vi.advanceTimersByTime(5*60000);
    click('+ Add Task');
    host.querySelector<HTMLInputElement>('[aria-label="Task"]')!.value='New study task';
    host.querySelector('.dtimer__add')!.dispatchEvent(new Event('submit',{cancelable:true}));
    expect(parseState(saved).tasks[0].spentMinutes).toBe(0);
    expect(parseState(saved).endsAt).toBeNull();
    expect(parseState(saved).log[0].taskId).toBeUndefined();
  });
  it('can increase an exhausted budget and only runs the additional time',()=>{
    mount({tasks:[{...task('a',10),spentMinutes:10}],activeTaskId:'a'});
    click('10/10 min');
    const input=host.querySelector<HTMLInputElement>('.dtimer__input--budget')!;
    input.value='15';host.querySelector('.dtimer__budget')!.dispatchEvent(new Event('submit',{cancelable:true}));
    expect(host.querySelector('.dtimer__face')!.textContent).toBe('5:00');
    click('Start');vi.advanceTimersByTime(5*60000);
    expect(parseState(saved).tasks[0].spentMinutes).toBe(15);
    expect(parseState(saved).endsAt).toBeNull();
  });
});
