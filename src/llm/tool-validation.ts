/** Provider tool schemas guide generation; validate again before any side effect. */
export function validateToolArguments(
  value: unknown,
  schema: Record<string, unknown>,
  path = "arguments",
): string | null {
  const type = schema.type;
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return `${path} must be an object`;
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const key of (schema.required ?? []) as string[])
      if (!Object.hasOwn(object, key)) return `${path}.${key} is required`;
    for (const [key, item] of Object.entries(object)) {
      if (!Object.hasOwn(properties, key)) {
        if (schema.additionalProperties === false)
          return `${path}.${key} is not allowed`;
      } else {
        const error = validateToolArguments(
          item,
          properties[key]!,
          `${path}.${key}`,
        );
        if (error) return error;
      }
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    for (let i = 0; i < value.length; i++) {
      const error = validateToolArguments(
        value[i],
        (schema.items ?? {}) as Record<string, unknown>,
        `${path}[${i}]`,
      );
      if (error) return error;
    }
  } else if (
    type &&
    (typeof value !== type || (type === "number" && !Number.isFinite(value)))
  )
    return `${path} must be ${type}`;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    return `${path} must be one of ${schema.enum.join(", ")}`;
  return null;
}
