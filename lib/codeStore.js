// lib/codeStore.js
// 验证码存储 - 使用文件系统持久化

import fs from 'fs';
import path from 'path';

const STORE_FILE = path.join(process.cwd(), '.verification-codes.json');

// 确保存储文件存在
function ensureStoreFile() {
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ codes: {}, times: {} }));
  }
}

// 读取所有数据
function readStore() {
  try {
    ensureStoreFile();
    const data = fs.readFileSync(STORE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('读取存储失败:', error);
    return { codes: {}, times: {} };
  }
}

// 写入所有数据
function writeStore(data) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('写入存储失败:', error);
  }
}

// 清理过期数据
function cleanExpired() {
  const store = readStore();
  const now = Date.now();
  
  // 清理过期的验证码
  for (const email in store.codes) {
    if (store.codes[email].expiresAt < now) {
      delete store.codes[email];
      delete store.times[`time_${email}`];
    }
  }
  
  // 清理过期的时间记录（超过5分钟）
  for (const key in store.times) {
    if (now - store.times[key] > 5 * 60 * 1000) {
      delete store.times[key];
    }
  }
  
  writeStore(store);
}

// 保存验证码
export function saveCode(email, code, expiresAt) {
  cleanExpired();
  const store = readStore();
  
  store.codes[email] = {
    code,
    expiresAt,
    attempts: 0
  };
  store.times[`time_${email}`] = Date.now();
  
  writeStore(store);
  console.log(`✅ 验证码已保存: ${email} -> ${code}`);
}

// 获取验证码
export function getCode(email) {
  cleanExpired();
  const store = readStore();
  return store.codes[email] || null;
}

// 删除验证码
export function deleteCode(email) {
  const store = readStore();
  delete store.codes[email];
  delete store.times[`time_${email}`];
  writeStore(store);
}

// 增加尝试次数
export function incrementAttempts(email) {
  const store = readStore();
  if (store.codes[email]) {
    store.codes[email].attempts++;
    writeStore(store);
  }
}

// 检查发送频率
export function checkRateLimit(email) {
  const store = readStore();
  const lastSent = store.times[`time_${email}`];
  
  if (lastSent && Date.now() - lastSent < 60000) {
    return false; // 频率限制
  }
  return true;
}

// 验证验证码
export function verifyCode(email, code) {
  const stored = getCode(email);
  
  if (!stored) {
    console.log(`❌ 验证失败: ${email} - 验证码不存在`);
    return { valid: false, error: '验证码不存在或已过期' };
  }

  // 检查过期
  if (Date.now() > stored.expiresAt) {
    deleteCode(email);
    console.log(`❌ 验证失败: ${email} - 验证码已过期`);
    return { valid: false, error: '验证码已过期' };
  }

  // 检查尝试次数
  if (stored.attempts >= 5) {
    deleteCode(email);
    console.log(`❌ 验证失败: ${email} - 尝试次数过多`);
    return { valid: false, error: '验证码错误次数过多，请重新获取' };
  }

  // 验证码错误
  if (stored.code !== code) {
    incrementAttempts(email);
    console.log(`❌ 验证失败: ${email} - 验证码错误 (${stored.code} vs ${code})`);
    return { valid: false, error: '验证码错误' };
  }

  // 验证成功，删除验证码
  deleteCode(email);
  console.log(`✅ 验证成功: ${email}`);
  
  return { valid: true };
}

// 保存已验证的邮箱
export function saveVerifiedEmail(email) {
  const store = readStore();
  if (!store.verified) {
    store.verified = {};
  }
  store.verified[email] = {
    verified: true,
    timestamp: Date.now()
  };
  writeStore(store);
  console.log(`✅ 邮箱已标记为验证: ${email}`);
}

// 检查邮箱是否已验证
export function isEmailVerified(email) {
  const store = readStore();
  const record = store.verified?.[email];
  
  if (!record) {
    console.log(`❌ 邮箱未验证: ${email}`);
    return false;
  }
  
  // 检查是否过期（5分钟）
  if (Date.now() - record.timestamp > 5 * 60 * 1000) {
    const newStore = readStore();
    delete newStore.verified[email];
    writeStore(newStore);
    console.log(`❌ 验证已过期: ${email}`);
    return false;
  }
  
  console.log(`✅ 邮箱验证有效: ${email}`);
  return true;
}