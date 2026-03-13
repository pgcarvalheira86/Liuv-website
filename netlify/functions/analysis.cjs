let handlerFn;
module.exports.handler = async function (event, context) {
  if (!handlerFn) {
    const m = await import('./analysis-handler.mjs');
    handlerFn = m.handler;
  }
  return handlerFn(event, context);
};
