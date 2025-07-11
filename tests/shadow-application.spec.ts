/**
 * Importing npm packages
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { InternalError } from '@shadow-library/common';

/**
 * Importing user defined packages
 */
import { Module, ModuleRef, ShadowApplication } from '@shadow-library/app';

/**
 * Defining types
 */

/**
 * Declaring the constants
 */
jest.mock('@lib/injector/module-registry', () => ({
  ModuleRegistry: jest.fn().mockImplementation(() => ({
    get: jest.fn(() => []),
    init: jest.fn(async () => {}),
    terminate: jest.fn(async () => {}),
  })),
}));

describe('ShadowApplication', () => {
  let app: ShadowApplication;

  @Module({})
  class AppModule {}

  beforeEach(() => {
    app = new ShadowApplication(AppModule);
  });

  describe('initialization and termination', () => {
    it('should initialize the application', async () => {
      jest.mocked(app['registry'].get).mockReturnValue({ isInitiated: () => false } as any);
      await app.init();
      expect(app['registry'].init).toBeCalledTimes(1);
    });

    it('should not initialize the application if already initiated', async () => {
      jest.spyOn(app, 'isInitiated').mockReturnValue(true);
      await app.init();
      expect(app['registry'].init).not.toBeCalled();
    });

    it('should start the application', async () => {
      const module = { start: jest.fn() };
      jest.spyOn(app, 'isInitiated').mockReturnValue(true);
      jest.mocked(app['registry'].get).mockReturnValue([module] as any);

      await app.start();
      expect(module.start).toBeCalledTimes(1);
    });

    it('should initialize the application if not initiated when starting the application', async () => {
      const module = { start: jest.fn(), init: jest.fn() };
      jest.spyOn(app, 'isInitiated').mockReturnValue(false);
      jest.mocked(app['registry'].get).mockReturnValue([module] as any);

      await app.start();
      expect(module.start).toBeCalledTimes(1);
    });

    it('should stop the application', async () => {
      jest.spyOn(app, 'isInitiated').mockReturnValue(true);
      await app.stop();
      expect(app['registry'].terminate).toBeCalledTimes(1);
    });

    it('should not stop the application if not initiated', async () => {
      jest.spyOn(app, 'isInitiated').mockReturnValue(false);
      await app.stop();
      expect(app['registry'].terminate).not.toBeCalled();
    });

    it('should stop the application when signal is received', async () => {
      jest.spyOn(app, 'isInitiated').mockReturnValue(true);
      jest.spyOn(process, 'kill').mockResolvedValue(null as never);
      jest.spyOn(process, 'removeListener').mockReturnThis();
      const stop = jest.spyOn(app, 'stop').mockReturnThis();

      await app.start();
      const listeners = process.listeners('SIGINT');
      listeners[2]?.('SIGINT');

      expect(listeners.length).toBeGreaterThanOrEqual(1);
      expect(stop).toBeCalledTimes(1);
    });

    it('should stop the application only once when signal is received', async () => {
      jest.spyOn(app, 'isInitiated').mockReturnValue(true);
      jest.spyOn(process, 'kill').mockResolvedValue(null as never);
      const stop = jest.spyOn(app, 'stop').mockReturnThis();

      await app.start();
      const listeners = process.listeners('SIGINT');
      listeners[3]?.('SIGINT');
      listeners[3]?.('SIGINT');

      expect(stop).toBeCalledTimes(1);
    });

    it('should not enable graceful shutdown if no signals are provided', async () => {
      jest.spyOn(app, 'isInitiated').mockReturnValue(true);
      const onSignal = jest.spyOn(process, 'on').mockReturnThis();
      app['options'].enableShutdownHooks = false;

      await app.start();
      expect(onSignal).not.toBeCalled();
    });
  });

  describe('select', () => {
    it('should return the module ref', () => {
      const instanceWrapper = { getInstance: jest.fn() };
      const module = { getInternalProvider: jest.fn().mockReturnValue(instanceWrapper) };
      jest.mocked(app['registry'].get).mockReturnValue(module as any);

      app.select(AppModule);

      expect(module.getInternalProvider).toBeCalledWith(ModuleRef);
      expect(instanceWrapper.getInstance).toBeCalledTimes(1);
    });
  });

  describe('get', () => {
    it('should throw an error if application not initiated', () => {
      jest.spyOn(app, 'isInitiated').mockReturnValue(false);
      expect(() => app.get(AppModule)).toThrowError(InternalError);
    });

    it('should throw an error is provider is not found', () => {
      jest.spyOn(app, 'isInitiated').mockReturnValue(true);
      jest.mocked(app['registry'].get).mockReturnValue([] as any);

      expect(() => app.get(AppModule)).toThrowError(InternalError);
      expect(() => app.get('RANDOM')).toThrowError(InternalError);
    });

    it('should return the instance of the provider', () => {
      const instanceWrapper = { getInstance: jest.fn() };
      const module = { getProvider: jest.fn().mockReturnValue(instanceWrapper) };
      jest.spyOn(app, 'isInitiated').mockReturnValue(true);
      jest.mocked(app['registry'].get).mockReturnValue([module] as any);

      app.get(AppModule);

      expect(module.getProvider).toBeCalledWith(AppModule);
      expect(instanceWrapper.getInstance).toBeCalledTimes(1);
    });
  });
});
