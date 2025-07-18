/**
 * Importing npm packages
 */
import assert from 'node:assert';

import { InternalError, Logger } from '@shadow-library/common';
import merge from 'deepmerge';
import { Class } from 'type-fest';

/**
 * Importing user defined packages
 */
import { DIErrors, DependencyGraph } from './helpers';
import { InstanceWrapper } from './instance-wrapper';
import { ModuleRef } from './module-ref';
import { ControllerRouteMetadata, Router } from '../classes';
import { CONTROLLER_METADATA, MODULE_METADATA, NAMESPACE, PARAMTYPES_METADATA, RETURN_TYPE_METADATA, ROUTE_METADATA } from '../constants';
import { ModuleMetadata, RouteMetadata } from '../decorators';
import { InjectionToken, ValueProvider } from '../interfaces';
import { ContextId, createContextId } from '../utils';

/**
 * Defining types
 */

type Controller = Record<string, any>;

export enum HookTypes {
  ON_MODULE_INIT = 'onModuleInit',
  ON_MODULE_DESTROY = 'onModuleDestroy',
  ON_APPLICATION_READY = 'onApplicationReady',
  ON_APPLICATION_STOP = 'onApplicationStop',
}

/**
 * Declaring the constants
 */

export class Module {
  private readonly logger = Logger.getLogger(NAMESPACE, 'Module');

  private readonly imports = [] as Module[];
  private readonly controllers = new Set<InstanceWrapper<Controller>>();
  private readonly providers = new Map<InjectionToken, InstanceWrapper>();
  private readonly exports = new Set<InjectionToken>();

  private readonly instance: InstanceWrapper;
  private readonly metadata: ModuleMetadata;

  constructor(private readonly metatype: Class<unknown>) {
    this.instance = new InstanceWrapper(metatype);
    this.metadata = Reflect.getMetadata(MODULE_METADATA, metatype);

    this.addModuleRef();
    this.loadProviders();
    this.loadControllers();
    this.loadExports(false);
  }

  private addModuleRef() {
    /* eslint-disable-next-line @typescript-eslint/no-this-alias */
    const self = this;
    const CustomModuleRef = class extends ModuleRef {
      override get<TInput = any, TResult = TInput>(token: InjectionToken): TResult {
        const provider = self.getInternalProvider(token);
        return provider.getInstance() as TResult;
      }

      override async resolve<TInput = any, TResult = TInput>(typeOrToken: Class<TInput>, contextId?: ContextId): Promise<TResult> {
        const provider = self.getInternalProvider(typeOrToken) as InstanceWrapper;
        if (!provider.isTransient()) throw new InternalError(`The provider '${provider.getTokenName()}' is not transient`);
        if (!contextId) contextId = createContextId();
        const instance = await provider.loadInstance(contextId);
        await provider.applyInterceptors(this, contextId);
        return instance;
      }
    };

    const provider: ValueProvider = { token: ModuleRef, useValue: new CustomModuleRef() };
    const instance = new InstanceWrapper(provider);
    this.providers.set(provider.token, instance);
  }

  private loadProviders() {
    const providers = this.metadata.providers ?? [];
    const providerMap = new Map<InjectionToken, InstanceWrapper>();
    const graph = new DependencyGraph();

    /** Create instance wrapper for all the providers */
    for (const provider of providers) {
      const instance = new InstanceWrapper(provider, true);
      const token = instance.getToken();
      if (providerMap.has(token)) throw new InternalError(`Duplicate provider '${token.toString()}' in module '${this.metatype.name}'`);
      providerMap.set(token, instance);
      graph.addNode(token);
    }

    /** Add the dependencies to the graph */
    for (const provider of providerMap.values()) {
      if (provider.isResolved()) continue;
      for (const dependency of provider.getDependencies()) {
        if (dependency.optional && !providerMap.has(dependency.token)) continue;
        else if (!dependency.forwardRef) graph.addDependency(provider.getToken(), dependency.token);
      }
    }

    /** Sort the providers based on the dependencies and insert the providers into the map */
    for (const token of graph.getInitOrder()) {
      const provider = providerMap.get(token);
      assert(provider, `Unexpected Provider '${token.toString()}' not found in the provider map`);
      this.providers.set(token, provider);
    }
  }

  private loadControllers() {
    const controllers = this.metadata.controllers ?? [];
    for (const controller of controllers) {
      const isController = Reflect.hasMetadata(CONTROLLER_METADATA, controller);
      if (!isController) throw new InternalError(`Class '${controller.name}' is not a controller`);
      const instance = new InstanceWrapper<Controller>(controller);
      this.controllers.add(instance);
    }
  }

  private loadExports(verify: boolean) {
    const exports = this.metadata.exports ?? [];
    for (const token of exports) {
      if (verify) {
        const provider = this.getInternalProvider(token, true);
        if (!provider) throw DIErrors.unknownExport(token, this.metatype);
      }
      this.exports.add(token);
    }
  }

  private getChildModules(): Set<Module> {
    const modules = new Set<Module>();
    const scanModules = (module: Module) => {
      if (modules.has(module)) return;
      modules.add(module);
      module.imports.forEach(importModule => scanModules(importModule));
    };

    this.imports.forEach(scanModules);
    return modules;
  }

  private getInternalProvider<T extends object = object>(token: InjectionToken): InstanceWrapper<T>;
  private getInternalProvider<T extends object = object>(token: InjectionToken, optional: boolean): InstanceWrapper<T> | undefined;
  private getInternalProvider<T extends object = object>(token: InjectionToken, optional?: boolean): InstanceWrapper<T> | undefined {
    const provider = this.providers.get(token);
    if (provider) return provider;

    for (const module of this.getChildModules()) {
      const provider = module.getProvider(token, true);
      if (provider) return provider;
    }

    if (!optional) DIErrors.notFound(token, this.metatype);
    return;
  }

  private detectCircularTransients() {
    const transientGraph = new DependencyGraph();

    for (const provider of this.providers.values()) {
      if (provider.isTransient()) {
        for (const dependency of provider.getDependencies()) {
          const dependencyInstance = this.getInternalProvider(dependency.token, dependency.optional);
          if (dependencyInstance && dependencyInstance.isTransient()) transientGraph.addDependency(provider.getToken(), dependency.token);
        }
      }
    }

    const circularPaths = transientGraph.determineCircularDependencies();
    if (circularPaths.length > 0) DIErrors.circularDependency(circularPaths, true);
  }

  getMetatype(): Class<unknown> {
    return this.metatype;
  }

  getProvider(token: InjectionToken): InstanceWrapper;
  getProvider(token: InjectionToken, optional: boolean): InstanceWrapper | undefined;
  getProvider(token: InjectionToken, optional?: boolean): InstanceWrapper | undefined {
    const isExported = this.exports.has(token);
    if (!isExported) {
      if (optional) return;
      return DIErrors.notFound(token, this.metatype);
    }

    return this.getInternalProvider(token, optional ?? false);
  }

  addImport(module: Module): this {
    this.imports.push(module);
    return this;
  }

  isInitiated(): boolean {
    return this.instance.isResolved();
  }

  private getAllInstances(): InstanceWrapper[] {
    const instances = [] as InstanceWrapper[];
    for (const provider of this.providers.values()) instances.push(provider);
    for (const controller of this.controllers) instances.push(controller);
    instances.push(this.instance);
    return instances;
  }

  private getRouter(): Router | undefined {
    const router = this.providers.get(Router) as InstanceWrapper<Router> | undefined;
    return router?.getInstance();
  }

  async init(): Promise<void> {
    this.logger.debug(`Initializing module '${this.instance.getTokenName()}'`);
    this.detectCircularTransients();

    /**
     * Loading the providers and controllers.
     * If a provider is transient, it will be loaded after all other providers.
     * This is to ensure that the transient provider instances are created only when they are needed.
     */
    const transientProviders: InstanceWrapper[] = [];
    const instances = this.getAllInstances();
    for (const provider of instances) {
      const dependencies = provider.getDependencies();
      for (let index = 0; index < dependencies.length; index++) {
        const dependency = dependencies[index];
        assert(dependency, `Unexpected dependency not found at index ${index}`);
        const instanceWrapper = this.getInternalProvider(dependency.token, dependency.optional);
        if (instanceWrapper) provider.setDependency(index, instanceWrapper);
      }

      if (provider.isTransient()) transientProviders.unshift(provider);
      else await provider.loadInstance();
    }

    /** Setting up the interceptors */
    const moduleRefProvider = this.getInternalProvider<ModuleRef>(ModuleRef);
    const moduleRef = moduleRefProvider.getInstance();
    for (const provider of instances) provider.applyInterceptorsToAllInstances(moduleRef);

    for (const provider of transientProviders) await provider.loadAllInstances();
    this.loadExports(true);

    this.logger.info(`Module '${this.instance.getTokenName()}' initialized`);
  }

  private getControllerRouteMetadata(controller: InstanceWrapper<Controller>): ControllerRouteMetadata {
    /* Extracting the route methods present in the instance */
    const methods = new Set<() => any>();
    const instance = controller.getInstance();
    let prototype = instance;
    do {
      for (const propertyName of Object.getOwnPropertyNames(prototype)) {
        const method = instance[propertyName];
        const isRouteMethod = typeof method === 'function' && Reflect.hasMetadata(ROUTE_METADATA, method) && method !== instance.constructor;
        if (isRouteMethod) methods.add(method);
      }
    } while ((prototype = Object.getPrototypeOf(prototype)));

    /* Extracting the route metadata from the route methods */
    const metatype = controller.getMetatype() as Class<Controller>;
    const metadata = Reflect.getMetadata(CONTROLLER_METADATA, metatype);
    const controllerRouteMetadata = Reflect.getMetadata(ROUTE_METADATA, metatype);
    const routes: ControllerRouteMetadata['routes'] = [];
    for (const method of methods) {
      const handlerName = method.name;
      const routeMetadata = Reflect.getMetadata(ROUTE_METADATA, method);
      const metadata = merge<RouteMetadata>(controllerRouteMetadata, routeMetadata);
      const paramtypes = Reflect.getMetadata(PARAMTYPES_METADATA, instance, handlerName);
      const returnType = Reflect.getMetadata(RETURN_TYPE_METADATA, instance, handlerName);
      routes.push({ metadata, handler: method.bind(instance), paramtypes, returnType, handlerName });
    }

    return { metadata, metatype, routes, instance };
  }

  async registerRoutes(): Promise<void> {
    const router = this.getRouter();
    if (!router) return;

    this.logger.debug(`Registering routes in module '${this.metatype.name}'`);
    const modules = this.getChildModules();
    const controllers = new Set(this.controllers);
    const controllerRouteMetadata: ControllerRouteMetadata[] = [];
    modules.forEach(module => module.controllers.forEach(controller => controllers.add(controller)));

    for (const controller of controllers) {
      const metadata = this.getControllerRouteMetadata(controller);
      controllerRouteMetadata.push(metadata);
    }

    await router.register(controllerRouteMetadata);
    this.logger.debug(`Routes registered in module '${this.metatype.name}'`);
  }

  async start(): Promise<void> {
    const router = this.getRouter();
    if (router) await router.start();
  }

  async stop(): Promise<void> {
    const router = this.getRouter();
    if (router) await router.stop();
  }

  async terminate(): Promise<void> {
    this.logger.debug(`Terminating module '${this.metatype.name}'`);
    for (const provider of this.getAllInstances().reverse()) {
      const instance = provider.getAllInstances();
      const promises = instance.map(instance => typeof instance.onModuleDestroy === 'function' && instance.onModuleDestroy());
      await Promise.all(promises);
      provider.clearInstance();
    }
    this.logger.debug(`Module '${this.metatype.name}' terminated`);
  }

  async callHook(method: HookTypes): Promise<void> {
    const instances = this.getAllInstances().flatMap(instance => instance.getAllInstances());
    for (const instance of instances) {
      const methodFn = instance[method];
      if (typeof methodFn === 'function') await methodFn.call(instance);
    }
  }
}
