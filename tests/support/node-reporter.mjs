// node:test reporter that writes one JSON line per finished test: { name, status, message }.
// tests/run-all.mjs reads these lines; a test name starts with its check id in brackets.
export default async function* reporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    if (event.data.details?.type === 'suite') continue;
    const error = event.data.details?.error;
    const message = error ? String(error.cause?.message || error.message || error).split('\n')[0].slice(0, 300) : null;
    yield `${JSON.stringify({ name: event.data.name, file: event.data.file, status: event.type === 'test:pass' ? 'pass' : 'fail', message })}\n`;
  }
}
