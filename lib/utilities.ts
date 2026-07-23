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
