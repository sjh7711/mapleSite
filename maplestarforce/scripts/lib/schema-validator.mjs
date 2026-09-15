function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

/**
 * Small, deterministic validator for the schema keywords used by the auction
 * interchange contracts. Domain invariants that JSON Schema cannot express
 * are checked separately by the importer.
 */
export function validateSchema(value, schema, valuePath = "$") {
  const errors = [];
  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    return [`${valuePath}: const ${JSON.stringify(schema.const)} expected`];
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    return [`${valuePath}: value is not in enum`];
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((type) => typeMatches(value, type))) {
      return [`${valuePath}: expected ${allowed.join("|")}`];
    }
  }
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(`${valuePath}: string shorter than ${schema.minLength}`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern, "u")).test(value)) {
      errors.push(`${valuePath}: pattern ${schema.pattern} mismatch`);
    }
  }
  if (typeof value === "number" && schema.minimum != null && value < schema.minimum) {
    errors.push(`${valuePath}: value is below ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.uniqueItems === true) {
      const serialized = value.map((entry) => JSON.stringify(entry));
      if (new Set(serialized).size !== serialized.length) {
        errors.push(`${valuePath}: duplicate array item`);
      }
    }
    if (schema.items) {
      value.forEach((entry, index) => {
        errors.push(...validateSchema(entry, schema.items, `${valuePath}[${index}]`));
      });
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${valuePath}.${key}: required property missing`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) {
        errors.push(...validateSchema(value[key], childSchema, `${valuePath}.${key}`));
      }
    }
  }
  return errors;
}
