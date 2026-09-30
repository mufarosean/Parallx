// toolArgumentCheck.ts — a tool call may carry only the arguments its tool
// declares.
//
// Nothing between the model and a handler checked argument NAMES: a handler
// reads the keys it knows and the rest vanish. A dropped filter is not a
// harmless extra. On 2026-09-28 `flashcards_query` was called with `matchAny`
// beside `query` (the schema nests it inside `where`); the search silently
// required every word, found nothing, and the chat told the user his cards
// had a gap in coverage that did not exist. On a write tool the same slip
// widens the write.
//
// So an undeclared argument is an error, reported before anything runs, in
// words the model can act on: which argument, where it belongs when the
// schema nests it, what the tool does accept.
//
// Applied where a MODEL's call is dispatched (the turn runners), against the
// schema that turn offered. Code that invokes a tool directly is not a guess
// at an interface and is left alone.

interface ISchemaLike {
  readonly properties?: unknown;
  readonly additionalProperties?: unknown;
  readonly items?: unknown;
}

function declaredProperties(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  const props = (schema as ISchemaLike).properties;
  return props && typeof props === 'object' && !Array.isArray(props)
    ? props as Record<string, unknown>
    : undefined;
}

const has = (obj: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

/** `deck_name`, `deckName` and `DeckName` are one name written three ways. */
const foldName = (name: string): string => name.replace(/[_\-\s]/g, '').toLowerCase();

/**
 * The argument names a call carries that its tool does not declare.
 *
 * Empty when there is nothing to check against: a schema without declared
 * properties cannot tell "takes no arguments" from "never described them",
 * and a schema that allows additional properties takes free-form input.
 */
export function findUndeclaredArguments(parameters: unknown, args: Record<string, unknown> | undefined): string[] {
  const props = declaredProperties(parameters);
  if (!props || Object.keys(props).length === 0) return [];
  const extra = (parameters as ISchemaLike).additionalProperties;
  if (extra === true || (extra !== null && typeof extra === 'object')) return [];
  return Object.keys(args ?? {}).filter((key) => !has(props, key));
}

/** Where an undeclared name does live: a nested object, or a differently written top-level name. */
function placeFor(name: string, props: Record<string, unknown>): string | undefined {
  const owners: string[] = [];
  for (const [key, schema] of Object.entries(props)) {
    const nested = declaredProperties(schema) ?? declaredProperties((schema as ISchemaLike | undefined)?.items);
    if (nested && has(nested, name)) owners.push(key);
  }
  if (owners.length) return `"${name}" goes inside ${owners.map((o) => `"${o}"`).join(' or ')}.`;
  const folded = foldName(name);
  const twin = Object.keys(props).find((key) => foldName(key) === folded);
  return twin ? `Did you mean "${twin}"?` : undefined;
}

/**
 * The error a call with undeclared arguments gets back, or undefined when
 * every argument is declared.
 */
export function describeUndeclaredArguments(
  toolName: string,
  parameters: unknown,
  args: Record<string, unknown> | undefined,
): string | undefined {
  const unknown = findUndeclaredArguments(parameters, args);
  if (unknown.length === 0) return undefined;
  const props = declaredProperties(parameters) ?? {};
  const named = unknown.map((name) => `"${name}"`).join(', ');
  const places = unknown.map((name) => placeFor(name, props)).filter((p): p is string => !!p);
  return [
    `Tool "${toolName}" was not run: it has no argument ${named}.`,
    ...places,
    `It accepts: ${Object.keys(props).join(', ')}.`,
    'Call it again with only those.',
  ].join(' ');
}
