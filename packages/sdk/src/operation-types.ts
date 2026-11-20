import type { operations } from './openapi.generated.js';
import type { restOperations } from './operations.generated.js';

export type OperationId = keyof operations;

type PathArguments<T> = T extends { path: infer Path } ? { path: Path } : { path?: never };
type QueryArguments<T> = T extends { query: infer Query }
  ? { query: Query }
  : T extends { query?: infer Query }
    ? { query?: Query }
    : { query?: never };

type WireBody<Content> = Content extends { 'application/json': infer Body }
  ? Body
  : Content extends { 'multipart/form-data': unknown }
    ? FormData
    : never;

type BodyArguments<T> = T extends { requestBody: { content: infer Content } }
  ? { body: WireBody<Content> }
  : T extends { requestBody?: { content: infer Content } }
    ? { body?: WireBody<Content> }
    : { body?: never };

export type OperationOptions<T extends OperationId> = PathArguments<operations[T]['parameters']> &
  QueryArguments<operations[T]['parameters']> &
  BodyArguments<operations[T]> & {
    signal?: AbortSignal;
    /** Browser session cookies. This replaces automatic bearer authentication for the call. */
    session?: boolean;
    /** Supply the CSRF header for a mutating session request. */
    csrfToken?: string;
    headers?: ConstructorParameters<typeof Headers>[0];
  };

type ResponseValue<Response> = Response extends { content: infer Content }
  ? Content[keyof Content]
  : void;

type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206;
type Registry = typeof restOperations;
type ResultForStatus<T extends OperationId, Status extends keyof operations[T]['responses']> =
  Status extends keyof Registry[T]['responseFormats']
    ? Registry[T]['responseFormats'][Status] extends 'blob'
      ? Blob
      : ResponseValue<operations[T]['responses'][Status]>
    : never;

export type OperationResult<T extends OperationId> = ResultForStatus<
  T,
  Extract<keyof operations[T]['responses'], SuccessStatus>
>;
