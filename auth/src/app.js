import "dotenv/config";
import express from 'express';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as GoogleStrategy } from "passport-google-oauth20"
import cookies from 'cookie-parser';
import cors from 'cors';

import authRoutes from './routes/auth.routes.js';


const app = express();

app.use(morgan('dev'));
app.use(cookies());
app.use(passport.initialize());
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost'],
    credentials: true,   // critical — allows cookies in cross-origin requests
    methods: [ 'GET', 'POST', 'PUT', 'DELETE', 'OPTIONS' ],
}));


passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:18080/api/auth/google/callback',
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

app.set('trust proxy', 1);
app.get("/_status/healthz", (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.get("/_status/readyz", (req, res) => {
    res.status(200).json({ status: 'ready' });
});

app.use('/api/auth', authRoutes);


export default app;
