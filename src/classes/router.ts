/**
 * Importing npm packages
 */
import { Class } from 'type-fest';

/**
 * Importing user defined packages
 */
import { ControllerMetadata, Injectable, RouteMetadata } from '../decorators';

/**
 * Defining types
 */

export interface RouteController {
  metadata: RouteMetadata;
  handlerName: string;
  handler: (...args: any[]) => any | Promise<any>;
  paramtypes: Class<unknown>[];
  returnType?: Class<unknown>;
}

export interface ControllerRouteMetadata {
  metatype: Class<unknown>;
  metadata: ControllerMetadata;
  instance: object;
  routes: RouteController[];
}

/**
 * Declaring the constants
 */

@Injectable()
export abstract class Router {
  /**
   * Method that will be called to register the controllers.
   * In terms of server, this method should register the controllers to the router.
   */
  abstract register(controller: ControllerRouteMetadata[]): any | Promise<any>;

  /**
   * Method that will be called to start the router.
   * In terms of server, this method should listen to requests in a particular port.
   */
  abstract start(): any | Promise<any>;

  /**
   * Method that will be called to stop the router.
   * In terms of server, this method should stop listening to requests and close the server.
   */
  abstract stop(): any | Promise<any>;
}
