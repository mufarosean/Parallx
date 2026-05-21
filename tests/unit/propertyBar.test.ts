// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { PageChangeKind, type IPage } from '../../src/built-in/canvas/canvasTypes';
import { PropertyBar } from '../../src/built-in/canvas/properties/propertyBar';
import type {
  IPageProperty,
  IPropertyDataService,
  IPropertyDefinition,
  PagePropertyChangeEvent,
  PropertyDefinitionChangeEvent,
} from '../../src/built-in/canvas/properties/propertyTypes';

type Listener<T> = (event: T) => void;

function eventHook<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    event(listener: Listener<T>) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire(event: T) {
      for (const listener of listeners) listener(event);
    },
  };
}

const createdDef: IPropertyDefinition = {
  name: 'created',
  type: 'datetime',
  config: {},
  sortOrder: 2,
  createdAt: '',
  updatedAt: '',
};

const modifiedDef: IPropertyDefinition = {
  name: 'modified',
  type: 'datetime',
  config: {},
  sortOrder: 3,
  createdAt: '',
  updatedAt: '',
};

function prop(key: string, value: unknown, definition: IPropertyDefinition): IPageProperty & { definition: IPropertyDefinition } {
  return {
    id: `prop-${key}`,
    pageId: 'page-1',
    key,
    valueType: definition.type,
    value,
    definition,
  };
}

function page(updatedAt: string): IPage {
  return {
    id: 'page-1',
    parentId: null,
    title: 'Test',
    icon: null,
    content: '{}',
    contentSchemaVersion: 1,
    revision: 1,
    sortOrder: 0,
    isArchived: false,
    coverUrl: null,
    coverYOffset: 0.5,
    fontFamily: 'default',
    fullWidth: false,
    smallText: false,
    isLocked: false,
    isFavorited: false,
    createdAt: '2026-05-21 02:00:00',
    updatedAt,
  };
}

function expectedLabel(sqliteTimestamp: string): string {
  const normalized = sqliteTimestamp.replace(' ', 'T') + 'Z';
  return new Date(normalized).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

describe('PropertyBar page timestamp refresh', () => {
  it('updates the modified row in place instead of re-rendering the full property bar', async () => {
    const pagePropertyEvents = eventHook<PagePropertyChangeEvent>();
    const definitionEvents = eventHook<PropertyDefinitionChangeEvent>();
    const pageEvents = eventHook<any>();
    const getPropertiesForPage = vi.fn(async () => [
      prop('created', '2026-05-21T02:00:00Z', createdDef),
      prop('modified', '2026-05-21T02:00:00Z', modifiedDef),
    ]);
    const propertyService = {
      onDidChangePageProperty: pagePropertyEvents.event,
      onDidChangeDefinition: definitionEvents.event,
      getPropertiesForPage,
      getAllDefinitions: vi.fn(async () => [createdDef, modifiedDef]),
      setProperty: vi.fn(),
      removeProperty: vi.fn(),
    } as unknown as IPropertyDataService;
    const dataService = {
      onDidChangePage: pageEvents.event,
    };

    const container = document.createElement('div');
    const header = document.createElement('div');
    container.appendChild(header);
    document.body.appendChild(container);

    const bar = new PropertyBar(container, header, 'page-1', propertyService, dataService as any);
    await bar.init();

    const body = container.querySelector('.canvas-property-bar__body') as HTMLElement;
    const createdRow = body.querySelector<HTMLElement>('[data-property-key="created"]')!;
    const modifiedRow = body.querySelector<HTMLElement>('[data-property-key="modified"]')!;

    pageEvents.fire({
      kind: PageChangeKind.Updated,
      pageId: 'page-1',
      page: page('2026-05-21 02:06:00'),
      changedFields: ['content', 'contentSchemaVersion'],
    });

    expect(getPropertiesForPage).toHaveBeenCalledTimes(1);
    expect(body.querySelector<HTMLElement>('[data-property-key="created"]')).toBe(createdRow);
    expect(body.querySelector<HTMLElement>('[data-property-key="modified"]')).toBe(modifiedRow);
    expect(modifiedRow.querySelector('.canvas-prop-date-trigger')?.textContent)
      .toBe(expectedLabel('2026-05-21 02:06:00'));

    bar.dispose();
    container.remove();
  });
});
