"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/plugin.ts
var plugin_exports = {};
__export(plugin_exports, {
  default: () => plugin_default,
  ringanPlugin: () => ringanPlugin
});
module.exports = __toCommonJS(plugin_exports);
var babelGenerator = __toESM(require("@babel/generator"), 1);
var import_parser = require("@babel/parser");
var babelTraverse = __toESM(require("@babel/traverse"), 1);
var t = __toESM(require("@babel/types"), 1);
function resolveDefault(mod) {
  const candidate = mod;
  if (typeof candidate?.default === "function") {
    return candidate.default;
  }
  if (typeof candidate?.default?.default === "function") {
    return candidate.default.default;
  }
  return mod;
}
var traverse = resolveDefault(babelTraverse);
var generate = resolveDefault(babelGenerator);
var DEFAULT_FUNCTION_NAMES = ["ringan"];
var CTX_NAME = "__ringan_ctx";
function matchesFilter(id, include, exclude) {
  const included = include ? typeof include === "function" ? include(id) : include.test(id) : /\.[cm]?[jt]sx?$/.test(id);
  const excluded = exclude ? typeof exclude === "function" ? exclude(id) : exclude.test(id) : /node_modules/.test(id);
  return included && !excluded;
}
function isRinganCallee(callee, names) {
  return t.isIdentifier(callee) && names.includes(callee.name);
}
function isAlreadyWrapped(node) {
  return t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name.includes("ringan_wrap");
}
function cloneFunctionFromArgument(argument, path) {
  if (t.isFunctionExpression(argument) || t.isArrowFunctionExpression(argument)) {
    return t.cloneNode(argument, true);
  }
  if (!t.isIdentifier(argument)) {
    return void 0;
  }
  const binding = path.scope.getBinding(argument.name);
  if (!binding) {
    return void 0;
  }
  if (binding.path.isFunctionDeclaration()) {
    const original = binding.path.node;
    return t.functionExpression(
      original.id ? t.identifier(`${original.id.name}__ringan`) : null,
      original.params.map((param) => t.cloneNode(param, true)),
      t.cloneNode(original.body, true),
      original.generator,
      true
    );
  }
  if (binding.path.isVariableDeclarator()) {
    const init = binding.path.node.init;
    if (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init)) {
      return t.cloneNode(init, true);
    }
  }
  return void 0;
}
function ensureBlock(body) {
  return t.isBlockStatement(body) ? body : t.blockStatement([body]);
}
function yieldStatement() {
  return t.expressionStatement(
    t.awaitExpression(
      t.callExpression(t.memberExpression(t.identifier(CTX_NAME), t.identifier("yield")), [])
    )
  );
}
function instrumentStatements(statements) {
  return statements.map((statement) => instrumentStatement(statement));
}
function instrumentLoopBody(body) {
  const block = ensureBlock(body);
  block.body = [yieldStatement(), ...instrumentStatements(block.body)];
  return block;
}
function instrumentStatement(statement) {
  if (t.isFunctionDeclaration(statement)) {
    return statement;
  }
  if (t.isForStatement(statement) || t.isWhileStatement(statement) || t.isDoWhileStatement(statement)) {
    statement.body = instrumentLoopBody(statement.body);
    return statement;
  }
  if (t.isForInStatement(statement) || t.isForOfStatement(statement)) {
    statement.body = instrumentLoopBody(statement.body);
    return statement;
  }
  if (t.isBlockStatement(statement)) {
    statement.body = instrumentStatements(statement.body);
    return statement;
  }
  if (t.isIfStatement(statement)) {
    statement.consequent = instrumentStatement(statement.consequent);
    if (statement.alternate) {
      statement.alternate = instrumentStatement(statement.alternate);
    }
    return statement;
  }
  if (t.isLabeledStatement(statement)) {
    statement.body = instrumentStatement(statement.body);
    return statement;
  }
  if (t.isSwitchStatement(statement)) {
    for (const switchCase of statement.cases) {
      switchCase.consequent = instrumentStatements(switchCase.consequent);
    }
    return statement;
  }
  if (t.isTryStatement(statement)) {
    statement.block.body = instrumentStatements(statement.block.body);
    if (statement.handler) {
      statement.handler.body.body = instrumentStatements(statement.handler.body.body);
    }
    if (statement.finalizer) {
      statement.finalizer.body = instrumentStatements(statement.finalizer.body);
    }
  }
  return statement;
}
function makeAsyncTransformedFunction(original) {
  if (original.generator || original.params.some((param) => t.isRestElement(param))) {
    return void 0;
  }
  const params = original.params.map((param) => t.cloneNode(param, true));
  params.push(t.identifier(CTX_NAME));
  const body = t.isBlockStatement(original.body) ? t.cloneNode(original.body, true) : t.blockStatement([t.returnStatement(t.cloneNode(original.body, true))]);
  body.body = instrumentStatements(body.body);
  if (t.isArrowFunctionExpression(original)) {
    return t.arrowFunctionExpression(params, body, true);
  }
  return t.functionExpression(
    original.id ? t.cloneNode(original.id, true) : null,
    params,
    body,
    false,
    true
  );
}
function ensureWrapImport(state) {
  if (state.wrapLocal) {
    return state.wrapLocal;
  }
  const program = state.program;
  if (!program) {
    state.wrapLocal = t.identifier("__ringan_wrap");
    return state.wrapLocal;
  }
  for (const node of program.node.body) {
    if (!t.isImportDeclaration(node) || node.source.value !== state.runtimeModule) {
      continue;
    }
    const existing = node.specifiers.find(
      (specifier) => t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported) && specifier.imported.name === "__ringan_wrap"
    );
    if (existing && t.isImportSpecifier(existing) && t.isIdentifier(existing.local)) {
      state.wrapLocal = t.identifier(existing.local.name);
      return state.wrapLocal;
    }
  }
  const localName = program.scope.hasBinding("__ringan_wrap") ? program.scope.generateUidIdentifier("ringan_wrap").name : "__ringan_wrap";
  state.wrapLocal = t.identifier(localName);
  program.node.body.unshift(
    t.importDeclaration(
      [t.importSpecifier(t.identifier(localName), t.identifier("__ringan_wrap"))],
      t.stringLiteral(state.runtimeModule)
    )
  );
  return state.wrapLocal;
}
function ringanPlugin(options = {}) {
  const functionNames = options.functionNames ?? DEFAULT_FUNCTION_NAMES;
  const runtimeModule = options.runtimeModule ?? "ringan/internal";
  return {
    name: "ringan",
    transform(code, id) {
      if (!matchesFilter(id, options.include, options.exclude) || !code.includes("ringan")) {
        return null;
      }
      const ast = (0, import_parser.parse)(code, {
        sourceType: "module",
        plugins: ["typescript", "jsx"]
      });
      const state = { runtimeModule };
      let changed = false;
      traverse(ast, {
        Program(path) {
          state.program = path;
        },
        CallExpression(path) {
          if (!isRinganCallee(path.node.callee, functionNames)) {
            return;
          }
          const [first] = path.node.arguments;
          if (!first || t.isSpreadElement(first) || t.isArgumentPlaceholder(first) || isAlreadyWrapped(first)) {
            return;
          }
          const cloned = cloneFunctionFromArgument(first, path);
          if (!cloned) {
            return;
          }
          const transformed = makeAsyncTransformedFunction(cloned);
          if (!transformed) {
            return;
          }
          const wrapLocal = ensureWrapImport(state);
          path.node.arguments[0] = t.callExpression(wrapLocal, [t.cloneNode(first, true), transformed]);
          changed = true;
        }
      });
      if (!changed) {
        return null;
      }
      const output = generate(
        ast,
        {
          sourceMaps: true,
          sourceFileName: id
        },
        code
      );
      return {
        code: output.code,
        map: output.map
      };
    }
  };
}
var plugin_default = ringanPlugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ringanPlugin
});
//# sourceMappingURL=plugin.cjs.map