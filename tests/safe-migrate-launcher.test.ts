import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";
import { prismaDeployInvocation, runPrisma } from "../scripts/safe-migrate.ts";

test("el lanzador usa el CLI local de Prisma mediante process.execPath y sin shell", () => {
  const environment = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
  const invocation = prismaDeployInvocation(environment);

  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.arguments_[0]!, /node_modules[\\/]prisma[\\/]build[\\/]index\.js$/);
  assert.deepEqual(invocation.arguments_.slice(1, 4), ["migrate", "deploy", "--config"]);
  assert.match(invocation.arguments_[4]!, /prisma\.migration\.config\.ts$/);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.env, environment);
  assert.equal(invocation.options.stdio, "inherit");
});

test("el lanzador propaga un fallo del proceso hijo", async () => {
  const fakeChild = new EventEmitter() as EventEmitter & { once: ChildProcess["once"] };
  const launch = () => {
    queueMicrotask(() => fakeChild.emit("error", new Error("launcher failure")));
    return fakeChild as unknown as ChildProcess;
  };

  await assert.rejects(
    () => runPrisma({ NODE_ENV: "test" }, launch),
    /launcher failure/,
  );
});

test("el lanzador propaga códigos de salida no nulos", async () => {
  const fakeChild = new EventEmitter() as EventEmitter & { once: ChildProcess["once"] };
  const launch = () => {
    queueMicrotask(() => fakeChild.emit("exit", 7));
    return fakeChild as unknown as ChildProcess;
  };

  await assert.doesNotReject(async () => {
    assert.equal(await runPrisma({ NODE_ENV: "test" }, launch), 7);
  });
});
