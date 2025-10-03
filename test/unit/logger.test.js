import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/lib/logger.js';

test('LOGGER TEST', async (t) => {


    const userLogger = {
        debug: (...args) => args,
        info: (...args) => args,
        warn: (...args) => args,
        error: (...args) => args,
    }

    await t.test('level debug should be ignored ', () => {
        const logger = createLogger(userLogger,'info');
        assert.deepStrictEqual(logger.debug('invisible'),undefined);
        assert.deepStrictEqual(logger.info('visible'),['visible']);
        assert.deepStrictEqual(logger.warn('visible'),['visible']);
        assert.deepStrictEqual(logger.error('visible'),['visible']);
    });

    await t.test('only level debug error should be visible', () => {
        const logger = createLogger(userLogger,'error');
        assert.deepStrictEqual(logger.debug('invisible'),undefined);
        assert.deepStrictEqual(logger.info('invisible'),undefined);
        assert.deepStrictEqual(logger.warn('invisible'),undefined);
        assert.deepStrictEqual(logger.error('visible'),['visible']);
    });

});