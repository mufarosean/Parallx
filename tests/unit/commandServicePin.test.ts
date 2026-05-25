/**
 * Pin: commandService barrel — re-exports CommandService from
 * `../commands/commandRegistry.js`.  Locked so workbench Phase 1
 * service registration imports remain stable.
 */
import { describe, it, expect } from "vitest";
import { CommandService } from "../../src/services/commandService";
import { CommandService as CommandServiceFromRegistry } from "../../src/commands/commandRegistry";

describe("commandService barrel", () => {
  it("exports CommandService as a constructor function", () => {
    expect(CommandService).toBeDefined();
    expect(typeof CommandService).toBe("function");
  });

  it("re-export points at the same class identity as commandRegistry's CommandService", () => {
    expect(CommandService).toBe(CommandServiceFromRegistry);
  });

  it("CommandService prototype exposes registerCommand/executeCommand/registerCommands", () => {
    const proto: any = CommandService.prototype;
    expect(typeof proto.registerCommand).toBe("function");
    expect(typeof proto.registerCommands).toBe("function");
    expect(typeof proto.executeCommand).toBe("function");
  });
});
