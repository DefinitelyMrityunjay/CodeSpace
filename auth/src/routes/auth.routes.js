import { Router } from "express";
import User from "../models/user.model.js";
import passport from "passport";
import { sendAuthNotification } from "../config/mq.js";
import jwt from "jsonwebtoken";

const router = Router();


router.get('/google', passport.authenticate('google', {
    session: false,
    scope: [ 'profile', 'email' ]
}));

router.get('/google/callback', passport.authenticate('google', {
    session: false,
    failureRedirect: '/'
}), async (req, res) => {
    try {
        const { id, displayName, emails, photos } = req.user;
        let user = await User.findOne({ googleId: id });



        if (!user) {
            user = new User({
                googleId: id,
                email: emails[ 0 ].value,
                name: displayName,
                avatar: photos[ 0 ].value
            });
            await user.save();
        }

        await sendAuthNotification({
            userId: user._id,
            action: 'google_login',
            timestamp: new Date(),
            email: emails[ 0 ].value
        })

        // Generate JWT token
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        const isProd = process.env.NODE_ENV === 'production'
        res.cookie('token', token, {
            httpOnly: true,
            secure: isProd,
            sameSite: isProd ? 'none' : 'lax',
            ...(isProd && { domain: process.env.COOKIE_DOMAIN }),
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.redirect('http://localhost:5174');
    } catch (err) {
        console.error('Error during Google authentication:', err);
        res.redirect('/'); // Redirect to your frontend on error
    }
});


router.get('/me', async (req, res) => {
    try {
        const token = req.cookies.token
        if (!token) return res.status(401).json({ error: 'Not authenticated' })
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        const user = await User.findById(decoded.id).select('-__v')
        if (!user) return res.status(401).json({ error: 'User not found' })
        res.json({ id: user._id, name: user.name, email: user.email, avatar: user.avatar })
    } catch {
        res.status(401).json({ error: 'Invalid token' })
    }
})

export default router;