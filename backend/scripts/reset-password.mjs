#!/usr/bin/env node
// Usage: npm run user:reset-password -w backend -- user@example.com
// Prompts for a new password (not echoed), updates it, and invalidates all existing sessions.
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import readline from 'node:readline';
import { loadConfig } from '../src/config/env.js';
import { User } from '../src/models/User.js';

const email = process.argv[2];
if (!email) { console.error('Usage: npm run user:reset-password -w backend -- <email>'); process.exit(1); }
const cfg = loadConfig();
const ask = (q) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
  rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); res(a); });
});
const pw = await ask('New password: ');
if (pw.length < 10 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) { console.error('Password must be at least 10 characters with upper-case, lower-case and a number.'); process.exit(1); }
await mongoose.connect(cfg.MONGODB_URI);
const user = await User.findOne({ email: email.toLowerCase() });
if (!user) { console.error('No such user.'); await mongoose.disconnect(); process.exit(1); }
user.passwordHash = await bcrypt.hash(pw, 12); user.tokenVersion += 1; await user.save();
console.log(`Password updated for ${user.email}. Existing sessions were signed out.`);
await mongoose.disconnect();
