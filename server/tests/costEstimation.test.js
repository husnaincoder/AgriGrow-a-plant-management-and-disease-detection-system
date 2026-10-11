const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const jwt = require('jsonwebtoken');

const costRoutes = require('../routes/costRoutes');
const CostEstimation = require('../models/CostEstimation');
const User = require('../models/User');
const { errorHandler } = require('../middleware/errorHandler');
const config = require('../config/env');

const app = express();
app.use(express.json());
app.use('/api/cost', costRoutes);
app.use(errorHandler);

let mongoServer;
let testUser;
let testToken;

jest.setTimeout(600000);

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    testUser = await User.create({
        name: 'Test Farmer',
        email: 'farmer@test.com',
        password: 'password123',
        role: 'farmer',
        isVerified: true
    });

    testToken = jwt.sign(
        { id: testUser._id, role: testUser.role, email: testUser.email },
        config.JWT_SECRET || 'testsecret',
        { expiresIn: '7d' }
    );
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

afterEach(async () => {
    await CostEstimation.deleteMany();
});

describe('Crop Budgeting & Economic Break-Even Analysis Module', () => {
    describe('Public Crop Reference Endpoints', () => {
        it('GET /api/cost/crops should return all supported reference crops', async () => {
            const res = await request(app).get('/api/cost/crops');
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.crops)).toBe(true);
            expect(res.body.data.crops.length).toBeGreaterThan(20);
        });

        it('GET /api/cost/crops/soil/loamy should return crops suited for loamy soil', async () => {
            const res = await request(app).get('/api/cost/crops/soil/loamy');
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.crops.length).toBeGreaterThan(0);
        });

        it('GET /api/cost/crops/season/rabi should return winter/rabi crops', async () => {
            const res = await request(app).get('/api/cost/crops/season/rabi');
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.crops.length).toBeGreaterThan(0);
        });
    });

    describe('POST /api/cost/estimate (Quick Economic Estimation)', () => {
        it('should require authentication', async () => {
            const res = await request(app)
                .post('/api/cost/estimate')
                .send({ cropName: 'wheat', area: 5 });
            expect(res.statusCode).toBe(401);
        });

        it('should accurately compute costs, revenue, profit, ROI, and break-even yield for wheat', async () => {
            const res = await request(app)
                .post('/api/cost/estimate')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    cropName: 'wheat',
                    area: 10,
                    areaUnit: 'acres',
                    soilType: 'loamy',
                    season: 'rabi',
                    irrigationType: 'drip'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);

            const est = res.body.data.estimation;
            expect(est.available).toBe(true);
            expect(est.crop).toBe('Wheat');
            expect(est.totalCost).toBeGreaterThan(0);
            expect(est.expectedYield.value).toBe(200); // 20 quintals/acre * 10 acres
            expect(est.expectedRevenue).toBe(455000);   // 200 * 2275
            expect(est.expectedProfit).toBe(est.expectedRevenue - est.totalCost);
            expect(est.roiNumeric).toBeGreaterThan(0);

            // Mathematical verification of break-even:
            // BreakEvenYield = totalCost / marketPrice
            const calculatedBreakEven = Math.round((est.totalCost / est.marketPrice.value) * 100) / 100;
            expect(est.breakEvenYield.value).toBe(calculatedBreakEven);
            expect(est.breakEvenYield.unit).toBe('quintal');
        });
    });

    describe('POST /api/cost/compare (Multi-Crop Economic Comparison)', () => {
        it('should rank multiple crops by ROI and identify lowest-cost and highest-profit options', async () => {
            const res = await request(app)
                .post('/api/cost/compare')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    cropNames: ['wheat', 'rice', 'cotton'],
                    area: 5,
                    soilType: 'alluvial'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.comparisons.length).toBe(3);
            expect(res.body.data.bestChoice).toBeDefined();
            expect(res.body.data.lowestCost).toBeDefined();
            expect(res.body.data.highestProfit).toBeDefined();
        });
    });

    describe('POST /api/cost/estimate/detailed (Database Persistence & History)', () => {
        it('should save detailed cost estimation snapshot to MongoDB with line items and break-even', async () => {
            const res = await request(app)
                .post('/api/cost/estimate/detailed')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    cropName: 'rice',
                    area: 4,
                    soilType: 'clay',
                    season: 'kharif',
                    irrigationType: 'flood',
                    notes: 'Planning for next monsoon season'
                });

            expect(res.statusCode).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.estimation._id).toBeDefined();

            const savedId = res.body.data.estimation._id;

            // Verify in database
            const doc = await CostEstimation.findById(savedId);
            expect(doc).not.toBeNull();
            expect(doc.cropName).toBe('Rice (Paddy)');
            expect(doc.totalCost).toBeGreaterThan(0);
            expect(doc.breakEvenYield.value).toBeGreaterThan(0);
            expect(doc.lineItems.length).toBeGreaterThan(0);

            // Retrieve single estimation via GET /api/cost/history/:id
            const getRes = await request(app)
                .get(`/api/cost/history/${savedId}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(getRes.statusCode).toBe(200);
            expect(getRes.body.data.estimation._id.toString()).toBe(savedId.toString());

            // Retrieve history list
            const historyRes = await request(app)
                .get('/api/cost/history')
                .set('Authorization', `Bearer ${testToken}`);

            expect(historyRes.statusCode).toBe(200);
            expect(historyRes.body.data.estimations.length).toBe(1);

            // Delete estimation
            const delRes = await request(app)
                .delete(`/api/cost/history/${savedId}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(delRes.statusCode).toBe(200);
            const afterDel = await CostEstimation.findById(savedId);
            expect(afterDel).toBeNull();
        });
    });
});
