// answerFormBlocks.ts — what chat contributes for its answer forms.
//
// The forms themselves are ui/answerForms(Core).ts. Chat registers the
// core ones, the command a worked solution's Next Step and Start Over
// run, and a page block for each form Save To Page can keep (Chart,
// Timeline, Live Numbers, Worked Solution). The blocks go through the
// same contribution point any tool's blocks do (api.canvas.registerBlock):
// the canvas knows nothing about chat. In a page the form keeps working
// (type a number, step through), and Edit Source opens its text.

import katex from 'katex';
import type { IDisposable } from '../../../platform/lifecycle.js';
import type { CanvasBlockRegistration } from '../../../api/bridges/canvasBlocksBridge.js';
import { escapeHtml } from '../../../ui/format.js';
import { htmlFragment, hydrateAnswerForms, renderAnswerForm, renderInlineBasic, type AnswerFormContext } from '../../../ui/answerForms.js';
import { CORE_FORM_BLOCKS, WORKED_STEP_COMMAND, registerCoreAnswerForms, stepWorkedForm } from '../../../ui/answerFormsCore.js';

export interface AnswerFormApi {
  readonly commands: { registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable };
  readonly canvas?: { registerBlock(registration: CanvasBlockRegistration): IDisposable };
}

const renderMath = (tex: string): string => katex.renderToString(tex, { throwOnError: false });
const PAGE_CONTEXT: AnswerFormContext = { renderInline: (md) => renderInlineBasic(md, renderMath), renderMath };

type CoreBlock = keyof typeof CORE_FORM_BLOCKS;

const BLOCKS: Readonly<Record<CoreBlock, { label: string; description: string; icon: string; sample: string }>> = {
  chart: {
    label: 'Chart',
    description: 'A headline chart: bars from label and value lines',
    icon: 'chart-bar',
    sample: 'title: A sentence that states the point\ncaption: What is measured\nFirst: 40 *\nSecond: 25\nThird: 15',
  },
  timeline: {
    label: 'Timeline',
    description: 'Dates in order, with today and the key date marked',
    icon: 'milestone',
    sample: 'Mar 3: Started (done)\nApr 2: Today (today)\nApr 15: Deadline (key)',
  },
  live: {
    label: 'Live Numbers',
    description: 'A calculation whose numbers you can change',
    icon: 'calculator',
    sample: 'price = $40 "Price"\nqty = 3 "Quantity"\ntotal = price * qty "Total"\n---\n{qty} at {price} each comes to {total}.',
  },
  worked: {
    label: 'Worked Solution',
    description: 'A solution shown one step at a time',
    icon: 'list-ordered',
    sample: 'Find the change: 72 − 60 = 12.\nDivide by where it started: 12 ÷ 60 = 0.2.\nWrite it as a percent: a 20% increase.',
  },
};

function formBlock(name: CoreBlock): CanvasBlockRegistration {
  const meta = BLOCKS[name];
  return {
    typeId: CORE_FORM_BLOCKS[name],
    label: meta.label,
    description: meta.description,
    icon: meta.icon,
    defaultConfig: { src: meta.sample, info: '' },
    readable: (config) => `\`\`\`${name}\n${String(config.src ?? '')}\n\`\`\``,
    render(body, ctx) {
      let editing = false;
      // A live number typed in the page is stored as the new source; that
      // store must not redraw the form under the caret.
      let keptByTyping: string | null = null;
      const draw = (): void => {
        const src = String(ctx.config.src ?? '');
        if (editing) {
          body.replaceChildren(htmlFragment(
            `<textarea class="px-af-block__source" spellcheck="false" aria-label="${escapeHtml(meta.label)} source">${escapeHtml(src)}</textarea>`
            + '<p class="px-af-block__hint">The same text the chat writes. Done draws it again.</p>',
          ));
          body.querySelector<HTMLTextAreaElement>('textarea')?.focus();
        } else {
          const html = renderAnswerForm(`${name} ${String(ctx.config.info ?? '')}`, src, PAGE_CONTEXT);
          if (html === null) ctx.showNote(`This ${meta.label.toLowerCase()} could not be read. Edit Source shows its text.`);
          else {
            body.replaceChildren(htmlFragment(html));
            hydrateAnswerForms(body, {
              onSourceChange: ctx.editable ? (next) => { keptByTyping = next; ctx.setConfig({ src: next }); } : undefined,
            });
          }
        }
        ctx.setActions(ctx.editable ? [{ label: editing ? 'Done' : 'Edit Source', run: toggleSource }] : []);
      };
      const toggleSource = (): void => {
        if (editing) {
          editing = false;
          const text = body.querySelector<HTMLTextAreaElement>('textarea')?.value;
          // A changed source is stored; the canvas then calls update(), which draws.
          if (text !== undefined && text !== String(ctx.config.src ?? '')) { ctx.setConfig({ src: text }); return; }
        } else editing = true;
        draw();
      };
      draw();
      return {
        update(config) {
          if (keptByTyping !== null && config.src === keptByTyping) { keptByTyping = null; return; }
          draw();
        },
      };
    },
  };
}

/** Register the core forms, the worked-solution command and the page blocks. */
export function registerAnswerFormContributions(api: AnswerFormApi): IDisposable[] {
  registerCoreAnswerForms();
  const out: IDisposable[] = [
    api.commands.registerCommand(WORKED_STEP_COMMAND, (key: unknown, action: unknown) =>
      stepWorkedForm(String(key ?? ''), action === 'reset' ? 'reset' : 'next')),
  ];
  if (api.canvas) for (const name of Object.keys(BLOCKS) as CoreBlock[]) out.push(api.canvas.registerBlock(formBlock(name)));
  return out;
}
