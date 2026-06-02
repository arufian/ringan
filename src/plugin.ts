import generate from "@babel/generator";
import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import type { Plugin } from "rollup";

export interface RinganPluginOptions {
  include?: RegExp | ((id: string) => boolean);
  exclude?: RegExp | ((id: string) => boolean);
  runtimeModule?: string;
  functionNames?: string[];
}

type TransformState = {
  program?: NodePath<t.Program>;
  wrapLocal?: t.Identifier;
  runtimeModule: string;
};

const DEFAULT_FUNCTION_NAMES = ["ringan"];
const CTX_NAME = "__ringan_ctx";

function matchesFilter(id: string, include?: RegExp | ((id: string) => boolean), exclude?: RegExp | ((id: string) => boolean)): boolean {
  const included = include ? (typeof include === "function" ? include(id) : include.test(id)) : /\.[cm]?[jt]sx?$/.test(id);
  const excluded = exclude ? (typeof exclude === "function" ? exclude(id) : exclude.test(id)) : /node_modules/.test(id);
  return included && !excluded;
}

function isRinganCallee(callee: t.Expression | t.V8IntrinsicIdentifier, names: string[]): boolean {
  return t.isIdentifier(callee) && names.includes(callee.name);
}

function isAlreadyWrapped(node: t.Node): boolean {
  return t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name.includes("ringan_wrap");
}

function cloneFunctionFromArgument(
  argument: t.Expression | t.SpreadElement | t.ArgumentPlaceholder,
  path: NodePath<t.CallExpression>
): t.FunctionExpression | t.ArrowFunctionExpression | undefined {
  if (t.isFunctionExpression(argument) || t.isArrowFunctionExpression(argument)) {
    return t.cloneNode(argument, true);
  }

  if (!t.isIdentifier(argument)) {
    return undefined;
  }

  const binding = path.scope.getBinding(argument.name);
  if (!binding) {
    return undefined;
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

  return undefined;
}

function ensureBlock(body: t.Statement | t.BlockStatement): t.BlockStatement {
  return t.isBlockStatement(body) ? body : t.blockStatement([body]);
}

function yieldStatement(): t.ExpressionStatement {
  return t.expressionStatement(
    t.awaitExpression(
      t.callExpression(t.memberExpression(t.identifier(CTX_NAME), t.identifier("yield")), [])
    )
  );
}

function instrumentStatements(statements: t.Statement[]): t.Statement[] {
  return statements.map((statement) => instrumentStatement(statement));
}

function instrumentLoopBody(body: t.Statement | t.BlockStatement): t.BlockStatement {
  const block = ensureBlock(body);
  block.body = [yieldStatement(), ...instrumentStatements(block.body)];
  return block;
}

function instrumentStatement(statement: t.Statement): t.Statement {
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

function makeAsyncTransformedFunction(
  original: t.FunctionExpression | t.ArrowFunctionExpression
): t.FunctionExpression | t.ArrowFunctionExpression | undefined {
  if (original.generator || original.params.some((param) => t.isRestElement(param))) {
    return undefined;
  }

  const params = original.params.map((param) => t.cloneNode(param, true));
  params.push(t.identifier(CTX_NAME));

  const body = t.isBlockStatement(original.body)
    ? t.cloneNode(original.body, true)
    : t.blockStatement([t.returnStatement(t.cloneNode(original.body, true))]);

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

function ensureWrapImport(state: TransformState): t.Identifier {
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
      (specifier) =>
        t.isImportSpecifier(specifier) &&
        t.isIdentifier(specifier.imported) &&
        specifier.imported.name === "__ringan_wrap"
    );
    if (existing && t.isImportSpecifier(existing) && t.isIdentifier(existing.local)) {
      state.wrapLocal = t.identifier(existing.local.name);
      return state.wrapLocal;
    }
  }

  const localName = program.scope.hasBinding("__ringan_wrap")
    ? program.scope.generateUidIdentifier("ringan_wrap").name
    : "__ringan_wrap";
  state.wrapLocal = t.identifier(localName);
  program.node.body.unshift(
    t.importDeclaration(
      [t.importSpecifier(t.identifier(localName), t.identifier("__ringan_wrap"))],
      t.stringLiteral(state.runtimeModule)
    )
  );
  return state.wrapLocal;
}

export function ringanPlugin(options: RinganPluginOptions = {}): Plugin {
  const functionNames = options.functionNames ?? DEFAULT_FUNCTION_NAMES;
  const runtimeModule = options.runtimeModule ?? "ringan/internal";

  return {
    name: "ringan",
    transform(code, id) {
      if (!matchesFilter(id, options.include, options.exclude) || !code.includes("ringan")) {
        return null;
      }

      const ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript", "jsx"]
      });
      const state: TransformState = { runtimeModule };
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

export default ringanPlugin;
