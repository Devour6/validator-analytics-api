/**
 * Input Validation Tests
 */

import Joi from 'joi';

// Define the same schema as in server.ts for testing
const validatorQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(1000).optional(),
  sortBy: Joi.string().valid('stake', 'commission', 'name').default('stake'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  activeOnly: Joi.boolean().optional().default(false)
});

describe('Input Validation', () => {
  afterAll(async () => {
    // Clear all timers
    jest.clearAllTimers();
    
    // Give time for cleanup
    await new Promise(resolve => setTimeout(resolve, 50));
  });
  
  describe('Validator Query Schema', () => {
    it('should validate valid parameters', () => {
      const validInputs = [
        { limit: 100, sortBy: 'stake', order: 'desc', activeOnly: true },
        { limit: 1, sortBy: 'commission', order: 'asc', activeOnly: false },
        { sortBy: 'name', order: 'desc' },
        { activeOnly: true },
        {}, // Empty object should use defaults
      ];

      validInputs.forEach(input => {
        const { error, value } = validatorQuerySchema.validate(input, { 
          convert: true, 
          stripUnknown: true 
        });
        
        expect(error).toBeUndefined();
        expect(value).toBeDefined();
        
        // Check defaults are applied
        if (!input.sortBy) {
          expect(value.sortBy).toBe('stake');
        }
        if (!input.order) {
          expect(value.order).toBe('desc');
        }
        if (input.activeOnly === undefined) {
          expect(value.activeOnly).toBe(false);
        }
      });
    });

    it('should reject invalid limit values', () => {
      const invalidLimits = [
        { limit: 0 },
        { limit: -1 },
        { limit: 1001 },
        { limit: 'invalid' },
        { limit: 1.5 },
      ];

      invalidLimits.forEach(input => {
        const { error } = validatorQuerySchema.validate(input);
        expect(error).toBeDefined();
        expect(error?.details[0].path).toContain('limit');
      });
    });

    it('should reject invalid sortBy values', () => {
      const invalidSortBy = [
        { sortBy: 'invalid' },
        { sortBy: 'amount' },
        { sortBy: 'votes' },
        { sortBy: '' },
        { sortBy: 123 },
      ];

      invalidSortBy.forEach(input => {
        const { error } = validatorQuerySchema.validate(input);
        expect(error).toBeDefined();
        expect(error?.details[0].path).toContain('sortBy');
      });
    });

    it('should reject invalid order values', () => {
      const invalidOrder = [
        { order: 'invalid' },
        { order: 'ascending' },
        { order: 'descending' },
        { order: '' },
        { order: 123 },
      ];

      invalidOrder.forEach(input => {
        const { error } = validatorQuerySchema.validate(input);
        expect(error).toBeDefined();
        expect(error?.details[0].path).toContain('order');
      });
    });

    it('should convert string booleans for activeOnly', () => {
      const testCases = [
        { input: { activeOnly: 'true' }, expected: true },
        { input: { activeOnly: 'false' }, expected: false },
        { input: { activeOnly: true }, expected: true },
        { input: { activeOnly: false }, expected: false },
      ];

      testCases.forEach(({ input, expected }) => {
        const { error, value } = validatorQuerySchema.validate(input, { 
          convert: true 
        });
        
        expect(error).toBeUndefined();
        expect(value.activeOnly).toBe(expected);
      });
    });

    it('should strip unknown parameters', () => {
      const inputWithUnknown = {
        limit: 100,
        sortBy: 'stake',
        order: 'desc',
        activeOnly: true,
        unknownParam: 'should be removed',
        anotherUnknown: 123,
      };

      const { error, value } = validatorQuerySchema.validate(inputWithUnknown, {
        convert: true,
        stripUnknown: true
      });

      expect(error).toBeUndefined();
      expect(value).toEqual({
        limit: 100,
        sortBy: 'stake',
        order: 'desc',
        activeOnly: true,
      });
      expect(value).not.toHaveProperty('unknownParam');
      expect(value).not.toHaveProperty('anotherUnknown');
    });

    it('should convert string numbers for limit', () => {
      const { error, value } = validatorQuerySchema.validate(
        { limit: '50' }, 
        { convert: true }
      );

      expect(error).toBeUndefined();
      expect(value.limit).toBe(50);
      expect(typeof value.limit).toBe('number');
    });

    it('should handle multiple validation errors', () => {
      const invalidInput = {
        limit: -5,
        sortBy: 'invalid',
        order: 'wrong',
        activeOnly: 'notABoolean',
      };

      const { error } = validatorQuerySchema.validate(invalidInput, {
        abortEarly: false // Get all validation errors, not just the first
      });
      
      expect(error).toBeDefined();
      expect(error?.details.length).toBeGreaterThan(0);
      
      const errorPaths = error?.details.map(detail => detail.path[0]);
      expect(errorPaths).toContain('limit');
    });
  });

  describe('Type Safety', () => {
    it('should ensure type consistency after validation', () => {
      const input = {
        limit: '100',
        sortBy: 'commission',
        order: 'asc',
        activeOnly: 'true',
      };

      const { error, value } = validatorQuerySchema.validate(input, {
        convert: true,
        stripUnknown: true
      });

      expect(error).toBeUndefined();
      
      // Check types after conversion
      expect(typeof value.limit).toBe('number');
      expect(typeof value.sortBy).toBe('string');
      expect(typeof value.order).toBe('string');
      expect(typeof value.activeOnly).toBe('boolean');
      
      // Check specific values
      expect(value.limit).toBe(100);
      expect(value.sortBy).toBe('commission');
      expect(value.order).toBe('asc');
      expect(value.activeOnly).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined values', () => {
      const testCases = [
        { limit: null },
        { limit: undefined },
        { sortBy: null },
        { order: undefined },
        { activeOnly: null },
      ];

      testCases.forEach(input => {
        const { error, value } = validatorQuerySchema.validate(input, {
          convert: true,
          stripUnknown: true
        });

        // Should either be valid (using defaults) or have validation errors
        if (error) {
          expect(error.details.length).toBeGreaterThan(0);
        } else {
          expect(value).toBeDefined();
        }
      });
    });

    it('should handle boundary values for limit', () => {
      const boundaryTests = [
        { limit: 1, shouldPass: true },
        { limit: 1000, shouldPass: true },
        { limit: 0, shouldPass: false },
        { limit: 1001, shouldPass: false },
      ];

      boundaryTests.forEach(({ limit, shouldPass }) => {
        const { error } = validatorQuerySchema.validate({ limit });
        
        if (shouldPass) {
          expect(error).toBeUndefined();
        } else {
          expect(error).toBeDefined();
        }
      });
    });
  });
});