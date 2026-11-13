#!/usr/bin/env node
// Prints a new key pair for push notifications (ADR 0412), with nothing to install:
//
//   node scripts/push-keys.mjs
//
// Put the public key in OPENBLOG_PUSH_PUBLIC_KEY and the private key in OPENBLOG_PUSH_PRIVATE_KEY
// where the hosted functions run. Make them once: new keys quietly stop every device that turned
// notifications on, and each has to turn them on again.
import { generateVapidKeys } from "../netlify/lib/web-push.mjs";

const { publicKey, privateKey } = generateVapidKeys();
console.log(`OPENBLOG_PUSH_PUBLIC_KEY=${publicKey}`);
console.log(`OPENBLOG_PUSH_PRIVATE_KEY=${privateKey}`);
