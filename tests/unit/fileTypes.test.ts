import { describe, it, expect } from "vitest";
import {
  FileOperationError,
  FileOperationErrorCode,
} from "../../src/platform/fileTypes";

describe("FileOperationError", () => {
  it("constructs with message + code", () => {
    const e = new FileOperationError("nope", "ENOENT");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(FileOperationError);
    expect(e.message).toBe("nope");
    expect(e.code).toBe("ENOENT");
    expect(e.uri).toBeUndefined();
    expect(e.name).toBe("FileOperationError");
  });

  it("captures the optional URI argument", () => {
    const uri = { fsPath: "/a/b", scheme: "file" } as any;
    const e = new FileOperationError("denied", "EACCES", uri);
    expect(e.uri).toBe(uri);
  });

  it("isNotFound returns true only for ENOENT FileOperationError instances", () => {
    expect(FileOperationError.isNotFound(new FileOperationError("x", "ENOENT"))).toBe(true);
    expect(FileOperationError.isNotFound(new FileOperationError("x", "EACCES"))).toBe(false);
    expect(FileOperationError.isNotFound(new Error("plain"))).toBe(false);
    expect(FileOperationError.isNotFound(null)).toBe(false);
    expect(FileOperationError.isNotFound(undefined)).toBe(false);
    expect(FileOperationError.isNotFound("ENOENT")).toBe(false);
  });

  it("isPermissionDenied returns true only for EACCES FileOperationError", () => {
    expect(
      FileOperationError.isPermissionDenied(new FileOperationError("x", "EACCES")),
    ).toBe(true);
    expect(
      FileOperationError.isPermissionDenied(new FileOperationError("x", "ENOENT")),
    ).toBe(false);
    expect(FileOperationError.isPermissionDenied(new Error("x"))).toBe(false);
    expect(FileOperationError.isPermissionDenied(null)).toBe(false);
  });

  it("isExists returns true only for EEXIST FileOperationError", () => {
    expect(FileOperationError.isExists(new FileOperationError("x", "EEXIST"))).toBe(true);
    expect(FileOperationError.isExists(new FileOperationError("x", "ENOENT"))).toBe(false);
    expect(FileOperationError.isExists({ code: "EEXIST" } as any)).toBe(false);
  });

  it("predicates use the FileOperationErrorCode string values", () => {
    expect(FileOperationErrorCode.FILE_NOT_FOUND).toBe("ENOENT");
    expect(FileOperationErrorCode.FILE_PERMISSION_DENIED).toBe("EACCES");
    expect(FileOperationErrorCode.FILE_EXISTS).toBe("EEXIST");
  });

  it("stack trace is preserved through Error subclassing", () => {
    const e = new FileOperationError("boom", "EUNKNOWN");
    expect(typeof e.stack).toBe("string");
    expect(e.stack).toContain("FileOperationError");
  });
});
