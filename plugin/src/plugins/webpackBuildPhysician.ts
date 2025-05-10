import { Compiler } from "webpack";
import "colorts/lib/string";
import {
  BuildMetrics,
  PLUGIN_NAME,
  TimedModule,
  IResults,
  IConstructor,
  INode,
  IAnalysisResults,
} from "./type";
import { builds } from "../api";
import { Logger } from "../utils/log";
import path from "path";
import Config from "../config";

const _assetRegex = /\.(png|jpg|jpeg|svg|gif|webp|aviff|ico)$/;
export class BuildPhysician {
  private metrics: BuildMetrics;
  private results: IResults;
  private config: IConstructor | null;
  private pluginName = PLUGIN_NAME;

  constructor(config: IConstructor | void) {
    this.metrics = {};
    this.results = {};
    if (config && !config.projectId)
      throw new Error("projectId is not mentioned!");
    this.config = config || null;
  }

  apply(compiler: Compiler) {
    this.generateDependencyGraph(compiler);
    this.generateLoadTimeMetrics(compiler);
    this.createBuildRecord(compiler);
  }

  private generateLoadTimeMetrics(compiler: Compiler) {
    this.metrics.plugins = [];
    const pluginTimes = new Map();
    // Compute build start time
    compiler.hooks.compile.tap(this.pluginName, () => {
      this.metrics.startTime = process.hrtime();
    });

    // Compute plugin execution time
    compiler.hooks.beforeRun.tapAsync(this.pluginName, (compiler, callback) => {
      compiler.hooks.compilation.tap(this.pluginName, (compilation) => {
        compilation.hooks.buildModule.tap(
          this.pluginName,
          (module: TimedModule) => {
            module.startTime = process.hrtime();
          }
        );

        compilation.hooks.succeedModule.tap(
          this.pluginName,
          (module: TimedModule) => {
            const diff = process.hrtime(module.startTime);
            const timeMs = diff[0] * 1000 + diff[1] / 1e6;
            const identifierName = module.identifier() || "unknown";

            const ext = path.extname(identifierName);

            let type = "unknown";
            if (ext.match(/\.js|\.jsx|\.ts|\.tsx/)) type = "script";
            else if (ext.match(/\.css|\.scss|\.less/)) type = "style";
            else if (ext.match(_assetRegex)) type = "image";
            else if (ext.match(/\.html/)) type = "html";
            else if (ext.match(/\.json/)) type = "json";

            pluginTimes.set(identifierName, {
              time: timeMs,
              size: module.size(),
              type,
              extension: ext,
            });
          }
        );
      });

      callback();
    });

    compiler.hooks.done.tap(this.pluginName, () => {
      this.metrics.plugins = Array.from(pluginTimes.entries()).map(
        ([name, metaData]) => ({
          name,
          ...metaData,
        })
      );
    });

    // Compute loader execution time
    compiler.hooks.compilation.tap(this.pluginName, (compilation) => {
      compilation.hooks.buildModule.tap(
        this.pluginName,
        (module: TimedModule) => {
          module.startTime = process.hrtime();
        }
      );

      compilation.hooks.succeedModule.tap(
        this.pluginName,
        (module: TimedModule) => {
          if (module.loaders.length) {
            const diff = process.hrtime(module.startTime);
            const timeMs = diff[0] * 1000 + diff[1] / 1e6;
            module.loadTime = timeMs;
          }
        }
      );
    });

    // Compute overall build time
    compiler.hooks.done.tap(this.pluginName, (stats) => {
      const diff = process.hrtime(this.metrics.startTime);
      this.metrics.totalBuildTime = (diff[0] * 1000 + diff[1] / 1e6).toFixed(2);
      this.metrics.bundleSize =
        stats
          .toJson()
          .assets?.reduce((sum, asset) => sum + (asset.size || 0), 0) || 0;

      const buildData = {
        buildTime: this.metrics.totalBuildTime,
        bundleSize: this.metrics.bundleSize,
        plugins: this.metrics.plugins,
      };

      this.results.resultMetrics = buildData;
      Logger.info("🔥 Build time", `${this.metrics.totalBuildTime} ms`);
    });

    // Track Hot Module Replacement (HMR) time
    compiler.hooks.invalid.tap(this.pluginName, () => {
      this.metrics.startTime = process.hrtime();
    });

    compiler.hooks.done.tap(this.pluginName, () => {
      if (this.metrics.startTime) {
        const diff = process.hrtime(this.metrics.startTime);
        this.metrics.hmrTime = (diff[0] * 1000 + diff[1] / 1e6).toFixed(2);
        this.results.resultMetrics.hmrTime = this.metrics.hmrTime;
        Logger.info("🔥 HMR Update Time", `${this.metrics.hmrTime} ms`);
      }
    });
  }

  private generateDependencyGraph(compiler: Compiler) {
    compiler.hooks.done.tap(this.pluginName, (stats) => {
      const compilationStats = stats.toJson();
      const entrypoints = compilationStats.entrypoints;
      const chunks = compilationStats.chunks;

      const entryModuleIds = Object.values(entrypoints)
        .flatMap((entry) => entry.chunks)
        .flatMap(
          (chunkId) =>
            chunks.find((chunk) => chunk.id === chunkId)?.modules || []
        )
        .map((mod) => mod.id);

      const nodes = compilationStats.modules.map((mod) => {
        const isRoot = entryModuleIds.includes(mod.id);
        const isUserCode = !mod.name.includes("node_modules");
        return {
          id: mod.id,
          name: mod.name,
          size: mod.size,
          isRoot: isRoot && isUserCode,
          dependencies: mod.reasons.map((r) => r.moduleId).filter(Boolean),
        };
      });

      const edges = compilationStats.modules.flatMap((mod) =>
        (mod.reasons || []).map((reason) => ({
          source: reason.moduleId,
          target: mod.id,
        }))
      );

      const analysis = this.analyzeDependencies(nodes);
      const data = { nodes, edges };
      this.results.depGraphMetrics = { metrics: data, analysis };
      Logger.info("🔥 Depgraph created");
    });
  }

  private analyzeDependencies(nodes: INode[]) {
    const issues: IAnalysisResults = {
      impactScores: {},
      deadModules: [],
      codeSplittingSuggestions: [],
    };

    const _BANDWIDTH = 10000;
    const scores = Object.entries(issues.impactScores);

    const detectDeadCode = (module: INode) => {
      const moduleId = module.id + "";
      // Impact Score based on size & number of dependencies
      issues.impactScores[moduleId] =
        module.size * (module.dependencies.length + 1);

      const isStaticAsset = moduleId.match(_assetRegex);
      if (!isStaticAsset) {
        // Detect Dead Code (modules with no dependents)
        const isDead = nodes.every((m) => !m.dependencies.includes(moduleId));
        const isCorrectModule = moduleId.trim();
        if (isDead && isCorrectModule) issues.deadModules.push(moduleId);
      }
    };

    const genCodeSplittingSuggestions = ([moduleId, score]: [
      string,
      number
    ]) => {
      const moduleName = moduleId.toLowerCase();
      const isInstalledDependency = moduleId.includes("node_modules");
      if (
        score > _BANDWIDTH &&
        !moduleName.match(_assetRegex) &&
        !isInstalledDependency
      )
        issues.codeSplittingSuggestions.push(moduleId);
    };

    nodes.forEach(detectDeadCode);
    scores.forEach(genCodeSplittingSuggestions);

    return issues;
  }

  private createBuildRecord(compiler: Compiler) {
    compiler.hooks.done.tapAsync(this.pluginName, async () => {
      const data = {
        ...this.results,
        projectId: this.config.projectId,
      };
      const { data: buildId } = await builds.post<string>("/", data);
      Logger.info("✨ Build Instance Created!".green);
      const _genLink =
        `${Config.BUILD_PHY_CLIENT_URL}/projects/${this.config.projectId}/builds/${buildId}`
          .red.underline.red;
      const _genLinkPreffix = "🚀 Check your bundle's insights at:: ".gray;
      Logger.info(_genLinkPreffix, _genLink);
      this.config?.emitOnBuildCompete?.({ ...this.results, buildId });
    });
  }
}
