import { randomBytes } from "node:crypto";

console.log(`NEXTAUTH_SECRET=${randomBytes(32).toString("base64url")}`);
