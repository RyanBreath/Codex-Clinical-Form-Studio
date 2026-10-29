import { describe, expect, it } from "vitest";
import { compileContract } from "../contract";
import schema from "../../../data-dictionaries/platform-vitals.json";
import type { CrfContract } from "../types";
import { contractForNewVersion } from "./versioning";

describe("升版契約識別", () => {
  it("同步版本並保留來源內容，舊版不受修改", () => {
    const source = schema as unknown as CrfContract;
    const next = contractForNewVersion(source, " 2.0.0 ");
    expect(next["x-airwayai"].schemaVersion).toBe("2.0.0");
    expect(next.$id).not.toBe(source.$id);
    expect(next.properties).toEqual(source.properties);
    expect(source["x-airwayai"].schemaVersion).toBe("1.0.0");
    expect(compileContract(next).ok).toBe(true);
  });
  it("拒絕空白版本，不產生可保存的新契約", () => {
    expect(() => contractForNewVersion(schema as unknown as CrfContract, " ")).toThrow();
  });
});
