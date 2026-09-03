import { createDiagnostic, err, ok } from "@x2zod/core";
import type { Result } from "@x2zod/core";

const trailingFragmentLength = 1;
const missingFragmentIndex = -1;
const parentPathSegmentLength = 3;
const uriReferenceCharacters = /^(?:[A-Za-z0-9._~!$&'()*+,;=:/?#@-]|%[0-9A-Fa-f]{2}|\[|\])*$/u;
const uriScheme = /^[A-Za-z][A-Za-z0-9+.-]*$/u;
const authorityUserInfo = /^(?:[A-Za-z0-9._~!$&'()*+,;=:-]|%[0-9A-Fa-f]{2})*$/u;
const authorityName = /^(?:[A-Za-z0-9._~!$&'()*+,;=-]|%[0-9A-Fa-f]{2})*$/u;
const authorityPort = /^\d*$/u;
const ipFuture = /^[vV][0-9A-Fa-f]+\.[A-Za-z0-9._~!$&'()*+,;=:-]+$/u;
const pathCharacters = /^(?:[A-Za-z0-9._~!$&'()*+,;=:@/-]|%[0-9A-Fa-f]{2})*$/u;
const queryOrFragmentCharacters = /^(?:[A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[0-9A-Fa-f]{2})*$/u;
const percentEncodedOctet = /%[0-9A-Fa-f]{2}/gu;
const registeredNameComponent = /%[0-9A-F]{2}|[^%]+/gu;
const unreservedCharacter = /^[A-Za-z0-9._~-]$/u;

type UriReferenceComponents = Readonly<{
  authority?: string | undefined;
  fragment?: string | undefined;
  path: string;
  query?: string | undefined;
  scheme?: string | undefined;
}>;

type AuthorityComponents = Readonly<{
  host: string;
  ipLiteral: boolean;
  port?: string | undefined;
  userInfo?: string | undefined;
}>;

const schemeSeparator = (hierarchy: string): number => {
  const colonIndex = hierarchy.indexOf(":");
  const slashIndex = hierarchy.indexOf("/");
  return colonIndex !== missingFragmentIndex &&
    (slashIndex === missingFragmentIndex || colonIndex < slashIndex)
    ? colonIndex
    : missingFragmentIndex;
};

const uriReferenceComponents = (uri: string): UriReferenceComponents => {
  const fragmentIndex = uri.indexOf("#");
  const withoutFragment =
    fragmentIndex === missingFragmentIndex ? uri : uri.slice(0, fragmentIndex);
  const queryIndex = withoutFragment.indexOf("?");
  const hierarchy =
    queryIndex === missingFragmentIndex ? withoutFragment : withoutFragment.slice(0, queryIndex);
  const separator = schemeSeparator(hierarchy);
  const scheme = separator === missingFragmentIndex ? undefined : hierarchy.slice(0, separator);
  const schemeOffset = separator === missingFragmentIndex ? 0 : separator + trailingFragmentLength;
  const remainder = hierarchy.slice(schemeOffset);
  if (!remainder.startsWith("//"))
    return {
      ...(fragmentIndex === missingFragmentIndex
        ? {}
        : { fragment: uri.slice(fragmentIndex + trailingFragmentLength) }),
      path: remainder,
      ...(queryIndex === missingFragmentIndex
        ? {}
        : { query: withoutFragment.slice(queryIndex + trailingFragmentLength) }),
      ...(scheme === undefined ? {} : { scheme }),
    };
  const pathIndex = remainder.indexOf("/", 2);
  const authorityEnd = pathIndex === missingFragmentIndex ? remainder.length : pathIndex;
  return {
    authority: remainder.slice(2, authorityEnd),
    ...(fragmentIndex === missingFragmentIndex
      ? {}
      : { fragment: uri.slice(fragmentIndex + trailingFragmentLength) }),
    path: remainder.slice(authorityEnd),
    ...(queryIndex === missingFragmentIndex
      ? {}
      : { query: withoutFragment.slice(queryIndex + trailingFragmentLength) }),
    ...(scheme === undefined ? {} : { scheme }),
  };
};

const serializeUriReference = (components: UriReferenceComponents): string =>
  `${components.scheme === undefined ? "" : `${components.scheme}:`}${components.authority === undefined ? "" : `//${components.authority}`}${components.path}${components.query === undefined ? "" : `?${components.query}`}${components.fragment === undefined ? "" : `#${components.fragment}`}`;

const normalizePercentEncoding = (value: string): string =>
  value.replace(percentEncodedOctet, (encoding) => {
    const character = String.fromCodePoint(
      Number.parseInt(encoding.slice(trailingFragmentLength), 16),
    );
    return unreservedCharacter.test(character) ? character : encoding.toUpperCase();
  });

const removeLastPathSegment = (path: string): string => {
  const separator = path.lastIndexOf("/");
  return separator === missingFragmentIndex ? "" : path.slice(0, separator);
};

type DotSegmentState = Readonly<{ input: string; output: string }>;

const removeDotSegmentStep = ({ input, output }: DotSegmentState): DotSegmentState => {
  if (input.startsWith("../")) return { input: input.slice(parentPathSegmentLength), output };
  if (input.startsWith("./")) return { input: input.slice(2), output };
  if (input.startsWith("/./")) return { input: input.slice(2), output };
  if (input === "/.") return { input: "/", output };
  if (input.startsWith("/../"))
    return { input: input.slice(parentPathSegmentLength), output: removeLastPathSegment(output) };
  if (input === "/..") return { input: "/", output: removeLastPathSegment(output) };
  if (input === "." || input === "..") return { input: "", output };
  const segmentEnd = input.indexOf("/", input.startsWith("/") ? 1 : 0);
  return segmentEnd === missingFragmentIndex
    ? { input: "", output: output + input }
    : { input: input.slice(segmentEnd), output: output + input.slice(0, segmentEnd) };
};

const removeDotSegments = (path: string): string => {
  let state: DotSegmentState = { input: path, output: "" };
  while (state.input !== "") state = removeDotSegmentStep(state);
  return state.output;
};

export const decodeJsonSchemaUriFragment = (
  fragment: string,
): Readonly<{ invalid: boolean; value: string }> => {
  try {
    return { invalid: false, value: decodeURIComponent(fragment) };
  } catch {
    return { invalid: true, value: fragment };
  }
};

export const decodeJsonSchemaPlainNameFragment = (reference: string): string | undefined => {
  const fragmentIndex = reference.lastIndexOf("#");
  if (fragmentIndex === missingFragmentIndex) return undefined;
  const fragment = reference.slice(fragmentIndex + trailingFragmentLength);
  if (fragment === "" || fragment.startsWith("/")) return undefined;
  const decoded = decodeJsonSchemaUriFragment(fragment);
  return decoded.invalid ? undefined : decoded.value;
};

const uriHierarchy = (uri: string): string => {
  const queryIndex = uri.indexOf("?");
  const fragmentIndex = uri.indexOf("#");
  const end = Math.min(
    queryIndex === missingFragmentIndex ? uri.length : queryIndex,
    fragmentIndex === missingFragmentIndex ? uri.length : fragmentIndex,
  );
  return uri.slice(0, end);
};

const validIpLiteral = (value: string): boolean => {
  if (ipFuture.test(value)) return true;
  try {
    return new URL(`http://[${value}]/`).hostname !== "";
  } catch {
    return false;
  }
};

const parseAuthority = (authority: string): AuthorityComponents | undefined => {
  const separator = authority.lastIndexOf("@");
  const userInfo = separator === missingFragmentIndex ? "" : authority.slice(0, separator);
  const hostAndPort = authority.slice(separator + trailingFragmentLength);
  if (!authorityUserInfo.test(userInfo)) return undefined;
  if (hostAndPort.startsWith("[")) {
    const closingBracket = hostAndPort.indexOf("]");
    if (closingBracket === missingFragmentIndex) return undefined;
    const remainder = hostAndPort.slice(closingBracket + trailingFragmentLength);
    const host = hostAndPort.slice(trailingFragmentLength, closingBracket);
    if (
      !validIpLiteral(host) ||
      (remainder !== "" && (!remainder.startsWith(":") || !authorityPort.test(remainder.slice(1))))
    )
      return undefined;
    return {
      host,
      ipLiteral: true,
      ...(remainder === "" ? {} : { port: remainder.slice(1) }),
      ...(separator === missingFragmentIndex ? {} : { userInfo }),
    };
  }
  if (hostAndPort.includes("[") || hostAndPort.includes("]")) return undefined;
  const portSeparator = hostAndPort.lastIndexOf(":");
  const host =
    portSeparator === missingFragmentIndex ? hostAndPort : hostAndPort.slice(0, portSeparator);
  const port = portSeparator === missingFragmentIndex ? "" : hostAndPort.slice(portSeparator + 1);
  if (!authorityName.test(host) || !authorityPort.test(port)) return undefined;
  return {
    host,
    ipLiteral: false,
    ...(portSeparator === missingFragmentIndex ? {} : { port }),
    ...(separator === missingFragmentIndex ? {} : { userInfo }),
  };
};

const validAuthority = (authority: string): boolean => parseAuthority(authority) !== undefined;

const canonicalIpLiteral = (host: string): string => {
  if (ipFuture.test(host)) return host.toLowerCase();
  return new URL(`http://[${host}]/`).hostname
    .slice(trailingFragmentLength, missingFragmentIndex)
    .toLowerCase();
};

const canonicalRegisteredName = (host: string): string =>
  normalizePercentEncoding(host).replace(registeredNameComponent, (component) =>
    component.startsWith("%") ? component : component.toLowerCase(),
  );

const canonicalAuthority = (authority: string): string => {
  const components = parseAuthority(authority);
  if (components === undefined) return authority;
  const userInfo =
    components.userInfo === undefined ? "" : `${normalizePercentEncoding(components.userInfo)}@`;
  const host = components.ipLiteral
    ? `[${canonicalIpLiteral(components.host)}]`
    : canonicalRegisteredName(components.host);
  const port = components.port === undefined ? "" : `:${components.port}`;
  return `${userInfo}${host}${port}`;
};

const validHierarchy = (hierarchy: string): boolean => {
  const separator = schemeSeparator(hierarchy);
  if (separator !== missingFragmentIndex && !uriScheme.test(hierarchy.slice(0, separator)))
    return false;
  const schemeOffset = separator === missingFragmentIndex ? 0 : separator + trailingFragmentLength;
  let authorityStart = missingFragmentIndex;
  if (hierarchy.startsWith("//")) authorityStart = 2;
  else if (hierarchy.startsWith("//", schemeOffset)) authorityStart = schemeOffset + 2;
  if (authorityStart !== missingFragmentIndex) {
    const pathStart = hierarchy.indexOf("/", authorityStart);
    const authorityEnd = pathStart === missingFragmentIndex ? hierarchy.length : pathStart;
    return (
      validAuthority(hierarchy.slice(authorityStart, authorityEnd)) &&
      pathCharacters.test(hierarchy.slice(authorityEnd))
    );
  }
  const path = hierarchy.slice(schemeOffset);
  if (!pathCharacters.test(path) || path.includes("[") || path.includes("]")) return false;
  if (separator !== missingFragmentIndex || path.startsWith("/")) return true;
  return !path
    .slice(0, path.indexOf("/") === missingFragmentIndex ? path.length : path.indexOf("/"))
    .includes(":");
};

export const isValidJsonSchemaUriReference = (uri: string): boolean => {
  const hierarchy = uriHierarchy(uri);
  const queryIndex = uri.indexOf("?");
  const fragmentIndex = uri.indexOf("#");
  const queryEnd = fragmentIndex === missingFragmentIndex ? uri.length : fragmentIndex;
  const query = queryIndex === missingFragmentIndex ? "" : uri.slice(queryIndex + 1, queryEnd);
  const fragment = fragmentIndex === missingFragmentIndex ? "" : uri.slice(fragmentIndex + 1);
  return (
    uriReferenceCharacters.test(uri) &&
    fragmentIndex === uri.lastIndexOf("#") &&
    validHierarchy(hierarchy) &&
    queryOrFragmentCharacters.test(query) &&
    queryOrFragmentCharacters.test(fragment)
  );
};

const canonicalComponents = (components: UriReferenceComponents): UriReferenceComponents => ({
  ...(components.authority === undefined
    ? {}
    : { authority: canonicalAuthority(components.authority) }),
  ...(components.fragment === undefined || components.fragment === ""
    ? {}
    : { fragment: normalizePercentEncoding(components.fragment) }),
  path: removeDotSegments(normalizePercentEncoding(components.path)),
  ...(components.query === undefined ? {} : { query: normalizePercentEncoding(components.query) }),
  ...(components.scheme === undefined ? {} : { scheme: components.scheme.toLowerCase() }),
});

export const canonicalJsonSchemaAddress = (uri: string): string => {
  const components = uriReferenceComponents(uri);
  const { scheme } = components;
  if (scheme?.toLowerCase() === "urn") {
    const end = uri.endsWith("#") ? uri.length - trailingFragmentLength : uri.length;
    return `urn:${uri.slice(scheme.length + trailingFragmentLength, end)}`;
  }
  return serializeUriReference(canonicalComponents(components));
};

export const jsonSchemaReferenceTargetAddress = (resourceUri: string, fragment?: string): string =>
  canonicalJsonSchemaAddress(
    fragment === undefined || fragment === "" ? resourceUri : `${resourceUri}#${fragment}`,
  );

const mergedPath = (base: UriReferenceComponents, referencePath: string): string => {
  if (base.authority !== undefined && base.path === "") return `/${referencePath}`;
  const separator = base.path.lastIndexOf("/");
  return `${separator === missingFragmentIndex ? "" : base.path.slice(0, separator + 1)}${referencePath}`;
};

const resolvedComponents = (
  base: UriReferenceComponents,
  reference: UriReferenceComponents,
): UriReferenceComponents => {
  if (reference.scheme !== undefined) return reference;
  if (reference.authority !== undefined) return { ...reference, scheme: base.scheme };
  if (reference.path === "")
    return {
      authority: base.authority,
      fragment: reference.fragment,
      path: base.path,
      query: reference.query ?? base.query,
      scheme: base.scheme,
    };
  return {
    authority: base.authority,
    fragment: reference.fragment,
    path: reference.path.startsWith("/") ? reference.path : mergedPath(base, reference.path),
    query: reference.query,
    scheme: base.scheme,
  };
};

export const resolveJsonSchemaUri = (baseUri: string, reference: string): string => {
  const base = uriReferenceComponents(canonicalJsonSchemaAddress(baseUri));
  const resolved = resolvedComponents(base, uriReferenceComponents(reference));
  return canonicalJsonSchemaAddress(serializeUriReference(resolved));
};

export const splitJsonSchemaUri = (
  uri: string,
): Readonly<{ fragment?: string | undefined; resourceUri: string }> => {
  const canonical = canonicalJsonSchemaAddress(uri);
  const components = uriReferenceComponents(canonical);
  if (components.fragment === undefined) return { resourceUri: canonical };
  return {
    fragment: components.fragment,
    resourceUri: serializeUriReference({ ...components, fragment: undefined }),
  };
};

const isValidJsonSchemaAbsoluteUri = (uri: string, allowTrailingEmptyFragment = false): boolean => {
  const components = uriReferenceComponents(uri);
  const validFragment =
    components.fragment === undefined || (allowTrailingEmptyFragment && components.fragment === "");
  return isValidJsonSchemaUriReference(uri) && components.scheme !== undefined && validFragment;
};

export const isNormalizedJsonSchemaUri = (
  uri: string,
  allowTrailingEmptyFragment = false,
): boolean => {
  const components = uriReferenceComponents(uri);
  if (!isValidJsonSchemaUriReference(uri) || components.scheme === undefined) return false;
  const canonical = canonicalJsonSchemaAddress(uri);
  return (
    uri === canonical ||
    (allowTrailingEmptyFragment &&
      uri.endsWith("#") &&
      uri.slice(0, missingFragmentIndex) === canonical)
  );
};

export const normalizeJsonSchemaRetrievalUri = (uri: string, subject: string): Result<string> => {
  const fragmentIndex = uri.indexOf("#");
  if (fragmentIndex !== missingFragmentIndex && fragmentIndex < uri.length - trailingFragmentLength)
    return err(
      createDiagnostic({
        code: "invalid_schema_document",
        message: `${subject} must be a fragmentless retrieval URI: ${uri}.`,
      }),
    );
  if (!isValidJsonSchemaAbsoluteUri(uri, true))
    return err(
      createDiagnostic({
        code: "invalid_schema_document",
        message: `${subject} must be a valid absolute, fragmentless retrieval URI: ${uri}.`,
      }),
    );
  return ok(canonicalJsonSchemaAddress(uri));
};
