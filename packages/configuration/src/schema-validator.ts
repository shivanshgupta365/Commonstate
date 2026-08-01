import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

export type CustomerSchemaIssue = Readonly<{
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
}>;

export type CustomerSchemaValidation = Readonly<{
  valid: boolean;
  issues: readonly CustomerSchemaIssue[];
}>;

export class CustomerSchemaError extends Error {
  readonly code: "INVALID_CUSTOMER_SCHEMA" | "CUSTOMER_VALUE_INVALID";
  readonly issues: readonly CustomerSchemaIssue[];

  constructor(
    code: "INVALID_CUSTOMER_SCHEMA" | "CUSTOMER_VALUE_INVALID",
    message: string,
    issues: readonly CustomerSchemaIssue[] = [],
  ) {
    super(message);
    this.name = "CustomerSchemaError";
    this.code = code;
    this.issues = issues;
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function toIssues(errors: readonly ErrorObject[] | null | undefined): readonly CustomerSchemaIssue[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "Value does not match the configured schema.",
  }));
}

/**
 * Ajv validates customer-defined entity attributes and predicate values. It is
 * deliberately limited to JSON Schema data validation; no customer code,
 * dynamic modules, or custom executable keywords are accepted.
 */
export class CustomerSchemaValidator {
  readonly #ajv: Ajv;
  readonly #cache = new Map<string, ValidateFunction>();

  constructor() {
    this.#ajv = new Ajv({
      allErrors: true,
      strict: true,
      removeAdditional: false,
      useDefaults: false,
      coerceTypes: false,
      validateSchema: true,
    });
    this.#ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
    this.#ajv.addFormat("date-time", (value: string) => Number.isFinite(Date.parse(value)));
  }

  compile(schema: Readonly<Record<string, unknown>>): ValidateFunction {
    const key = JSON.stringify(stable(schema));
    const cached = this.#cache.get(key);
    if (cached) return cached;
    try {
      const validator = this.#ajv.compile(structuredClone(schema));
      this.#cache.set(key, validator);
      return validator;
    } catch (error) {
      throw new CustomerSchemaError(
        "INVALID_CUSTOMER_SCHEMA",
        error instanceof Error ? error.message : "Customer JSON Schema is invalid.",
      );
    }
  }

  validate(
    schema: Readonly<Record<string, unknown>>,
    value: unknown,
  ): CustomerSchemaValidation {
    const validator = this.compile(schema);
    const valid = validator(value);
    return { valid: Boolean(valid), issues: valid ? [] : toIssues(validator.errors) };
  }

  assert(
    schema: Readonly<Record<string, unknown>>,
    value: unknown,
  ): void {
    const result = this.validate(schema, value);
    if (!result.valid) {
      throw new CustomerSchemaError(
        "CUSTOMER_VALUE_INVALID",
        `Customer value does not match its configured JSON Schema (${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}).`,
        result.issues,
      );
    }
  }
}
