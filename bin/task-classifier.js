#!/usr/bin/env node
/**
 * Task Classifier — 判断用户输入是 coding 任务还是普通对话
 *
 * 用法: node scripts/task-classifier.js "<user input>"
 * 输出: "coding" | "default"
 */

const CODING_KEYWORDS = [
  // 代码相关
  "write code", "coding", "implement", "fix bug", "refactor",
  "debug", "create function", "write a script", "pull request",
  "git commit", "merge", "push", "deploy", "npm install",
  // 技术问题
  "error", "exception", "syntax", "compile", "build",
  "runtime error", "stack trace", "typescript", "javascript",
  // 文件操作
  "edit file", "create file", "modify", "delete file",
  "read file", "查看文件", "改文件", "创建文件",
  // 代码相关中文
  "代码", "编程", "写代码", "修bug", "调试", "重构",
  "改代码", "实现", "函数", "类", "接口", "模块",
  // git
  "提交", "推送", "合并", "分支",
  // 命令
  "run command", "execute", "执行命令", "跑一下",
];

function isCodingTask(input) {
  const text = String(input || "").toLowerCase();
  if (!text.trim()) return false;

  // 如果文本太短(<10字)且不含代码关键词，不算coding
  if (text.length < 10) return false;

  return CODING_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

const input = process.argv.slice(2).join(" ");
const result = isCodingTask(input) ? "coding" : "default";
process.stdout.write(result);
