import chalk from "chalk";

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * The unified surface every connector implements. Extracting it here lets each
 * module be checked against one shape, so drift (a missing method, a different
 * signature) is a compile error rather than a convention violation.
 *
 * It is an abstract base class rather than an interface so that shared behavior
 * (`safeValue`) lives in one place and subclasses inherit it instead of wiring
 * it up individually, and so callers can `instanceof` a connector.
 *
 * `execute` is optional because some backends (e.g. BigQuery) have no separate
 * non-returning statement path; subclasses that support it override the stub.
 */
export abstract class BaseConnector {
    abstract query<T = any>(query: string, params?: Record<string, any> | any[]): Promise<T[]>;
    abstract insert(table: string, data: any): Promise<void>;
    execute?(query: string, params?: Record<string, any> | any[]): Promise<void>;
    /**
     * Release any resources the connector holds (connection pools, open file
     * handles). Optional because some backends (e.g. BigQuery) keep no
     * persistent connection; subclasses that do override the stub. Callers that
     * work through the shared surface can `await connector.close?.()` on shutdown
     * so the process can exit cleanly regardless of backend.
     */
    close?(): Promise<void>;
    safeValue(value: unknown): string {
        return safeValue(value);
    }
}

/**
 * Backwards-compatible alias for the connector surface. Prefer referring to
 * `BaseConnector` in new code; this keeps `type Connector` imports working.
 */
export type Connector = BaseConnector;

/**
 * The `safeValue` implementation duplicated verbatim across every existing
 * connector: allow a short alphanumeric-ish string (quoted) or a number,
 * reject everything else.
 */
export function safeValue(value: unknown): string {
    if (typeof value === "string")
        return /^[a-z0-9,./_-]*$/i.test(value) && value.length <= 64 ? `'${value}'` : "null";
    else if (typeof value === "number")
        return String(value);
    else
        throw `Unsafe value for query: "${value}"`;
}

/**
 * Wrap an error thrown while running `query` with the SQL (and params) that
 * produced it. This is the copy-pasted try/catch block shared by the connectors
 * whose drivers throw synchronously/awaitably on a bad statement.
 */
export function wrapQueryError(err: unknown, query: string, params?: Record<string, any> | any[]): Error {
    const message = `${err instanceof Error ? err.message : JSON.stringify(err)}\nQUERY: ${query}${params ? `\nPARAMS: ${JSON.stringify(params)}` : ""}`;
    return new Error(message);
}

/**
 * The VERBOSE block printed before a query runs: the SQL, then the params if any.
 * A no-op unless `process.env.VERBOSE` is set.
 */
export function logQuery(query: string, params?: Record<string, any> | any[]): void {
    if (!process.env.VERBOSE)
        return;
    console.log();
    console.log(chalk.gray(query));
    if (params && Object.keys(params).length > 0)
        console.log(chalk.gray(`QUERY PARAMS: ${JSON.stringify(params)}`));
}

/**
 * The VERBOSE block printed before an execute runs.
 * A no-op unless `process.env.VERBOSE` is set.
 */
export function logExecute(query: string, params?: Record<string, any> | any[]): void {
    if (!process.env.VERBOSE)
        return;
    console.log(chalk.gray(query));
    if (params)
        console.log(chalk.gray(JSON.stringify(params, null, 2)));
}

/**
 * The VERBOSE block printed after a query returns: row count and elapsed time.
 * A no-op unless `process.env.VERBOSE` is set.
 */
export function logQueryResult(rowCount: number, t0: number): void {
    if (process.env.VERBOSE)
        console.log(chalk.gray(`(${rowCount} rows returned in ${((Date.now() - t0) / 1000).toFixed(3)} seconds)`));
}

/**
 * The VERBOSE block printed after an execute completes: elapsed time.
 * A no-op unless `process.env.VERBOSE` is set.
 */
export function logExecuteResult(t0: number): void {
    if (process.env.VERBOSE)
        console.log(chalk.gray(`(query executed in ${((Date.now() - t0) / 1000).toFixed(3)} seconds)`));
}

/**
 * Load a database driver on first use.
 *
 * Every driver is an optional peer dependency: installing polysql installs none
 * of them, and importing polysql must not fail when some (or all) are absent.
 * Each connector therefore imports its driver through this helper the first time
 * it needs one, with a literal `import("<package>")` so bundlers can still see
 * the specifier. A missing package is reported with the name to install rather
 * than Node's raw resolution error; any other failure is passed through as-is.
 *
 * Callers cache the returned promise so the driver is resolved once per process.
 */
export async function loadDriver<T>(pkg: string, connector: string, importer: () => Promise<T>): Promise<T> {
    try {
        return await importer();
    }
    catch (err) {
        if (isModuleNotFound(err, pkg))
            throw new Error(`The ${connector} connector requires the "${pkg}" package, which is not installed. Install it with: npm install ${pkg}`);
        throw err;
    }
}

// True when `err` is Node's module-resolution failure for `pkg` itself (as
// opposed to a package that `pkg` depends on, which should surface unchanged).
function isModuleNotFound(err: unknown, pkg: string): boolean {
    const code = (err as { code?: unknown } | undefined)?.code;
    if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND")
        return false;
    const message = err instanceof Error ? err.message : String(err);
    return message.includes(`'${pkg}'`) || message.includes(`"${pkg}"`);
}

/**
 * Resolve the value a CommonJS driver exports (`module.exports`) from the
 * namespace object a dynamic `import()` of it returns, which wraps that value as
 * `default`. A module with no `default` (a native ES module) is returned as-is.
 * Typed against the driver's own `typeof import("<pkg>")`, which for an
 * `export =` package is the export value rather than the namespace.
 */
export function interopDefault<T>(module: T | { default: T }): T {
    return typeof module === "object" && module !== null && "default" in module ? (module as { default: T }).default : module as T;
}
