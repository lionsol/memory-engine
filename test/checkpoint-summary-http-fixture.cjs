// Offline-only HTTPS boundary shared by summary contract regressions.
const https = require("node:https");
const { EventEmitter } = require("node:events");
const config = require("../lib/checkpoint/config");

async function withFakeHttps(run, handler) {
  const names = ["getDSKey", "getDSBaseUrl", "getSFKey", "getSFBaseUrl"];
  const original = { request: https.request, ...Object.fromEntries(names.map(name => [name, config[name]])) };
  const requests = [];
  for (const name of names) config[name] = () => name.endsWith("Key") ? "fake-key-only" : "https://fixture.invalid";
  https.request = (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => { request.destroyed = true; };
    request.setTimeout = () => {};
    request.write = text => { request.body = JSON.parse(text); };
    request.end = () => handler(request, callback);
    requests.push(request);
    return request;
  };
  try { return await run(requests); }
  finally {
    https.request = original.request;
    for (const name of names) config[name] = original[name];
  }
}
function emitJson(callback, object, { bytewise = false } = {}) {
  const response = new EventEmitter();
  response.headers = {};
  response.destroy = () => { response.destroyed = true; };
  callback(response);
  const text = JSON.stringify(object);
  const bytes = Buffer.from(text);
  if (bytewise) {
    for (let index = 0; index < bytes.length; index++) response.emit("data", bytes.subarray(index, index + 1));
  } else response.emit("data", bytes);
  response.emit("end");
  return { response, text };
}
function completion(content, finish_reason = "stop", extra = {}) {
  return { choices: [{ message: { content }, finish_reason }], ...extra };
}
module.exports = { withFakeHttps, emitJson, completion };
