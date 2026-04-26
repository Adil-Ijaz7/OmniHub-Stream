const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'adilijaz227@gmail.com').toLowerCase();
const SALT_ROUNDS = 10;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const buildTmdbUrl = (path, params = {}) => {
    const query = new URLSearchParams({ api_key: process.env.TMDB_API_KEY, ...params });
    return `https://api.themoviedb.org/3${path}?${query.toString()}`;
};

const upsertMediaContent = async (tmdbId, mediaType) => {
    if (!tmdbId || !mediaType || !['movie', 'tv'].includes(mediaType)) return null;

    try {
        const tmdbUrl = buildTmdbUrl(`/${mediaType}/${tmdbId}`);
        const response = await fetch(tmdbUrl);
        const tmdbData = await response.json();

        if (!response.ok || tmdbData.success === false) {
            return null;
        }

        const title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const releaseDate = mediaType === 'movie' ? tmdbData.release_date : tmdbData.first_air_date;

        const upsertContentQuery = `
            INSERT INTO MEDIA_CONTENT (
                tmdb_id, content_type, title, description, release_date,
                language_code, poster_path, backdrop_path, runtime_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                content_type = VALUES(content_type),
                title = VALUES(title),
                description = VALUES(description),
                release_date = VALUES(release_date),
                language_code = VALUES(language_code),
                poster_path = VALUES(poster_path),
                backdrop_path = VALUES(backdrop_path),
                runtime_minutes = VALUES(runtime_minutes)
        `;

        const runtimeMinutes = mediaType === 'movie'
            ? (tmdbData.runtime || null)
            : (tmdbData.episode_run_time?.[0] || null);

        await pool.query(upsertContentQuery, [
            tmdbData.id,
            mediaType,
            title || 'Untitled',
            tmdbData.overview || null,
            releaseDate || null,
            tmdbData.original_language || null,
            tmdbData.poster_path || null,
            tmdbData.backdrop_path || null,
            runtimeMinutes
        ]);

        const [contentRows] = await pool.query(
            'SELECT content_id FROM MEDIA_CONTENT WHERE tmdb_id = ? LIMIT 1',
            [tmdbData.id]
        );

        if (contentRows.length === 0) return null;
        const contentId = contentRows[0].content_id;

        const genres = tmdbData.genres || [];
        for (const genre of genres) {
            await pool.query(
                'INSERT INTO GENRES (genre_name) VALUES (?) ON DUPLICATE KEY UPDATE genre_name = VALUES(genre_name)',
                [genre.name]
            );

            const [genreRows] = await pool.query(
                'SELECT genre_id FROM GENRES WHERE genre_name = ? LIMIT 1',
                [genre.name]
            );

            if (genreRows.length > 0) {
                await pool.query(
                    'INSERT IGNORE INTO CONTENT_GENRES (content_id, genre_id) VALUES (?, ?)',
                    [contentId, genreRows[0].genre_id]
                );
            }
        }

        return { contentId, tmdbData };
    } catch (error) {
        console.error('Media Upsert Error:', error);
        return null;
    }
};

const upsertEpisodeDetails = async (contentId, tmdbId, seasonNumber, episodeNumber) => {
    if (!contentId || !tmdbId || !seasonNumber || !episodeNumber) return;

    try {
        const tmdbUrl = buildTmdbUrl(`/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`);
        const response = await fetch(tmdbUrl);
        const episode = await response.json();

        if (!response.ok || episode.success === false) return;

        const upsertEpisodeQuery = `
            INSERT INTO EPISODES (
                content_id, season_number, episode_number, title,
                description, air_date, runtime_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                title = VALUES(title),
                description = VALUES(description),
                air_date = VALUES(air_date),
                runtime_minutes = VALUES(runtime_minutes)
        `;

        await pool.query(upsertEpisodeQuery, [
            contentId,
            seasonNumber,
            episodeNumber,
            episode.name || null,
            episode.overview || null,
            episode.air_date || null,
            episode.runtime || null
        ]);
    } catch (error) {
        console.error('Episode Upsert Error:', error);
    }
};

const generateToken = (user) => jwt.sign(
    { user_id: user.user_id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
);

const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Authentication token is required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

const requireAdmin = async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            'SELECT role, email FROM USERS WHERE user_id = ? LIMIT 1',
            [req.user.user_id]
        );

        if (rows.length === 0) {
            return res.status(403).json({ error: 'Admin access denied' });
        }

        const role = rows[0].role || 'user';
        const email = String(rows[0].email || '').toLowerCase();
        if (role !== 'admin' && email !== ADMIN_EMAIL) {
            return res.status(403).json({ error: 'Admin access denied' });
        }

        next();
    } catch (error) {
        console.error('Admin Auth Error:', error);
        res.status(500).json({ error: 'Failed to verify admin access' });
    }
};

const getValidatedProfileId = async (userId, profileId) => {
    if (!profileId || !Number.isFinite(Number(profileId))) return null;

    const normalizedProfileId = Number(profileId);
    const [rows] = await pool.query(
        'SELECT profile_id FROM PROFILES WHERE profile_id = ? AND user_id = ? LIMIT 1',
        [normalizedProfileId, userId]
    );

    if (rows.length === 0) return null;
    return normalizedProfileId;
};

const initDatabase = async () => {
    // Legacy content cache table retained for backward compatibility.
    const createLegacyContentTable = `
        CREATE TABLE IF NOT EXISTS CONTENT (
            content_id INT AUTO_INCREMENT PRIMARY KEY,
            tmdb_id INT NOT NULL UNIQUE,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            release_year INT,
            poster_url VARCHAR(255),
            content_type VARCHAR(20) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;

    const createUsersTable = `
        CREATE TABLE IF NOT EXISTS USERS (
            user_id INT AUTO_INCREMENT PRIMARY KEY,
            full_name VARCHAR(120) NOT NULL,
            email VARCHAR(191) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role ENUM('user', 'admin') DEFAULT 'user',
            subscription_status ENUM('active', 'inactive', 'suspended') DEFAULT 'inactive',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;

    const createProfilesTable = `
        CREATE TABLE IF NOT EXISTS PROFILES (
            profile_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            profile_name VARCHAR(80) NOT NULL,
            maturity_level ENUM('kids', 'teens', 'adults') DEFAULT 'adults',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE,
            UNIQUE KEY uq_user_profile_name (user_id, profile_name)
        )
    `;

    const createPlansTable = `
        CREATE TABLE IF NOT EXISTS SUBSCRIPTION_PLANS (
            plan_id INT AUTO_INCREMENT PRIMARY KEY,
            plan_code VARCHAR(50) NOT NULL UNIQUE,
            plan_name VARCHAR(80) NOT NULL,
            monthly_price DECIMAL(10,2) NOT NULL,
            max_profiles INT NOT NULL DEFAULT 1,
            max_stream_quality VARCHAR(20) DEFAULT 'HD'
        )
    `;

    const createUserSubscriptionsTable = `
        CREATE TABLE IF NOT EXISTS USER_SUBSCRIPTIONS (
            subscription_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            plan_id INT NOT NULL,
            status ENUM('active', 'inactive', 'cancelled', 'expired') DEFAULT 'inactive',
            started_at DATETIME NOT NULL,
            expires_at DATETIME,
            auto_renew BOOLEAN DEFAULT TRUE,
            FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE,
            FOREIGN KEY (plan_id) REFERENCES SUBSCRIPTION_PLANS(plan_id)
        )
    `;

    const createPaymentsTable = `
        CREATE TABLE IF NOT EXISTS SUBSCRIPTION_PAYMENTS (
            payment_id INT AUTO_INCREMENT PRIMARY KEY,
            subscription_id INT NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            currency CHAR(3) NOT NULL DEFAULT 'USD',
            billing_cycle ENUM('monthly', 'quarterly', 'yearly') DEFAULT 'monthly',
            payment_status ENUM('paid', 'failed', 'pending', 'refunded') DEFAULT 'paid',
            payment_date DATETIME NOT NULL,
            transaction_reference VARCHAR(120),
            FOREIGN KEY (subscription_id) REFERENCES USER_SUBSCRIPTIONS(subscription_id) ON DELETE CASCADE
        )
    `;

    const createMediaContentTable = `
        CREATE TABLE IF NOT EXISTS MEDIA_CONTENT (
            content_id INT AUTO_INCREMENT PRIMARY KEY,
            tmdb_id INT NOT NULL UNIQUE,
            content_type ENUM('movie', 'tv') NOT NULL,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            release_date DATE,
            language_code VARCHAR(8),
            poster_path VARCHAR(255),
            backdrop_path VARCHAR(255),
            runtime_minutes INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;

    const createGenresTable = `
        CREATE TABLE IF NOT EXISTS GENRES (
            genre_id INT AUTO_INCREMENT PRIMARY KEY,
            genre_name VARCHAR(100) NOT NULL UNIQUE
        )
    `;

    const createContentGenresTable = `
        CREATE TABLE IF NOT EXISTS CONTENT_GENRES (
            content_id INT NOT NULL,
            genre_id INT NOT NULL,
            PRIMARY KEY (content_id, genre_id),
            FOREIGN KEY (content_id) REFERENCES MEDIA_CONTENT(content_id) ON DELETE CASCADE,
            FOREIGN KEY (genre_id) REFERENCES GENRES(genre_id) ON DELETE CASCADE
        )
    `;

    const createEpisodesTable = `
        CREATE TABLE IF NOT EXISTS EPISODES (
            episode_id INT AUTO_INCREMENT PRIMARY KEY,
            content_id INT NOT NULL,
            season_number INT NOT NULL,
            episode_number INT NOT NULL,
            title VARCHAR(255),
            description TEXT,
            air_date DATE,
            runtime_minutes INT,
            UNIQUE KEY uq_episode (content_id, season_number, episode_number),
            FOREIGN KEY (content_id) REFERENCES MEDIA_CONTENT(content_id) ON DELETE CASCADE
        )
    `;

    const createPeopleTable = `
        CREATE TABLE IF NOT EXISTS PEOPLE (
            person_id INT AUTO_INCREMENT PRIMARY KEY,
            full_name VARCHAR(255) NOT NULL,
            tmdb_person_id INT UNIQUE,
            profession ENUM('actor', 'director', 'writer', 'producer', 'other') DEFAULT 'actor'
        )
    `;

    const createContentCastTable = `
        CREATE TABLE IF NOT EXISTS CONTENT_CAST (
            content_id INT NOT NULL,
            person_id INT NOT NULL,
            role_name VARCHAR(255),
            billing_order INT,
            PRIMARY KEY (content_id, person_id),
            FOREIGN KEY (content_id) REFERENCES MEDIA_CONTENT(content_id) ON DELETE CASCADE,
            FOREIGN KEY (person_id) REFERENCES PEOPLE(person_id) ON DELETE CASCADE
        )
    `;

    const createWatchHistoryTable = `
        CREATE TABLE IF NOT EXISTS WATCH_HISTORY (
            watch_id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            profile_id INT,
            tmdb_id INT NOT NULL,
            media_type ENUM('movie', 'tv') NOT NULL,
            season_number INT,
            episode_number INT,
            watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            duration_watched_seconds INT DEFAULT 0,
            duration_total_seconds INT DEFAULT 0,
            completed BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE,
            FOREIGN KEY (profile_id) REFERENCES PROFILES(profile_id) ON DELETE SET NULL
        )
    `;

    const createRatingsTable = `
        CREATE TABLE IF NOT EXISTS RATINGS_REVIEWS (
            rating_id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            tmdb_id INT NOT NULL,
            media_type ENUM('movie', 'tv') NOT NULL,
            rating_value DECIMAL(2,1) NOT NULL,
            review_text TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CHECK (rating_value >= 1.0 AND rating_value <= 5.0),
            UNIQUE KEY uq_user_content_rating (user_id, tmdb_id, media_type),
            FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE
        )
    `;

    const createUserFavoritesTable = `
        CREATE TABLE IF NOT EXISTS USER_FAVORITES (
            favorite_id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            tmdb_id INT NOT NULL,
            media_type ENUM('movie', 'tv') NOT NULL,
            title VARCHAR(255) NOT NULL,
            poster_path VARCHAR(255),
            vote_average DECIMAL(3,1),
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_user_favorite (user_id, tmdb_id, media_type),
            FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE
        )
    `;

    const createWatchlistTable = `
        CREATE TABLE IF NOT EXISTS WATCHLIST (
            watchlist_id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            tmdb_id INT NOT NULL,
            media_type ENUM('movie', 'tv') NOT NULL,
            title VARCHAR(255) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_user_watchlist (user_id, tmdb_id, media_type),
            FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE
        )
    `;

    const createWatchProgressTable = `
        CREATE TABLE IF NOT EXISTS WATCH_PROGRESS (
            progress_id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            profile_id INT NOT NULL,
            tmdb_id INT NOT NULL,
            media_type ENUM('movie', 'tv') NOT NULL,
            season_number INT,
            episode_number INT,
            last_position_seconds INT NOT NULL DEFAULT 0,
            total_watched_seconds INT NOT NULL DEFAULT 0,
            completed BOOLEAN DEFAULT FALSE,
            last_watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_watch_progress (user_id, profile_id, tmdb_id, media_type, season_number, episode_number),
            FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE,
            FOREIGN KEY (profile_id) REFERENCES PROFILES(profile_id) ON DELETE CASCADE
        )
    `;

    const createSubscriptionRequestsTable = `
        CREATE TABLE IF NOT EXISTS SUBSCRIPTION_REQUESTS (
            request_id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            plan_id INT NOT NULL,
            payment_method VARCHAR(50) DEFAULT 'mock-card',
            payment_reference VARCHAR(120),
            payment_amount DECIMAL(10,2) NOT NULL,
            status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            approved_by INT,
            approved_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE,
            FOREIGN KEY (plan_id) REFERENCES SUBSCRIPTION_PLANS(plan_id),
            FOREIGN KEY (approved_by) REFERENCES USERS(user_id) ON DELETE SET NULL
        )
    `;

    await pool.query(createLegacyContentTable);
    await pool.query(createUsersTable);

    const [roleColumnRows] = await pool.query("SHOW COLUMNS FROM USERS LIKE 'role'");
    if (roleColumnRows.length === 0) {
        await pool.query("ALTER TABLE USERS ADD COLUMN role ENUM('user','admin') DEFAULT 'user' AFTER password_hash");
    }
    await pool.query(createProfilesTable);
    await pool.query(createPlansTable);
    await pool.query(createUserSubscriptionsTable);
    await pool.query(createPaymentsTable);
    await pool.query(createMediaContentTable);
    await pool.query(createGenresTable);
    await pool.query(createContentGenresTable);
    await pool.query(createEpisodesTable);
    await pool.query(createPeopleTable);
    await pool.query(createContentCastTable);
    await pool.query(createWatchHistoryTable);
    await pool.query(createRatingsTable);
    await pool.query(createUserFavoritesTable);
    await pool.query(createWatchlistTable);
    await pool.query(createWatchProgressTable);
    await pool.query(createSubscriptionRequestsTable);

    const [favoriteProfileColumnRows] = await pool.query("SHOW COLUMNS FROM USER_FAVORITES LIKE 'profile_id'");
    if (favoriteProfileColumnRows.length === 0) {
        await pool.query('ALTER TABLE USER_FAVORITES ADD COLUMN profile_id INT NULL AFTER user_id');
        await pool.query('ALTER TABLE USER_FAVORITES ADD CONSTRAINT fk_user_favorites_profile FOREIGN KEY (profile_id) REFERENCES PROFILES(profile_id) ON DELETE SET NULL');
    }

    const [favoriteUniqueIdxRows] = await pool.query("SHOW INDEX FROM USER_FAVORITES WHERE Key_name = 'uq_user_favorite'");
    if (favoriteUniqueIdxRows.length > 0) {
        // Ensure FK-required indexes exist before dropping legacy unique index.
        const [userFkIndexRows] = await pool.query("SHOW INDEX FROM USER_FAVORITES WHERE Key_name = 'idx_user_favorites_user_id'");
        if (userFkIndexRows.length === 0) {
            await pool.query('ALTER TABLE USER_FAVORITES ADD INDEX idx_user_favorites_user_id (user_id)');
        }

        const [profileFkIndexRows] = await pool.query("SHOW INDEX FROM USER_FAVORITES WHERE Key_name = 'idx_user_favorites_profile_id'");
        if (profileFkIndexRows.length === 0) {
            await pool.query('ALTER TABLE USER_FAVORITES ADD INDEX idx_user_favorites_profile_id (profile_id)');
        }

        await pool.query('ALTER TABLE USER_FAVORITES DROP INDEX uq_user_favorite');
    }

    const [favoriteUniqueProfileRows] = await pool.query("SHOW INDEX FROM USER_FAVORITES WHERE Key_name = 'uq_user_favorite_profile'");
    if (favoriteUniqueProfileRows.length === 0) {
        await pool.query('ALTER TABLE USER_FAVORITES ADD UNIQUE KEY uq_user_favorite_profile (user_id, profile_id, tmdb_id, media_type)');
    }

    const seedPlansQuery = `
        INSERT INTO SUBSCRIPTION_PLANS (plan_code, plan_name, monthly_price, max_profiles, max_stream_quality)
        VALUES
            ('basic', 'Basic', 7.99, 1, 'HD'),
            ('standard', 'Standard', 12.99, 3, 'Full HD'),
            ('premium', 'Premium', 17.99, 5, '4K'),
            ('pro', 'Pro', 22.99, 6, '4K + HDR')
        ON DUPLICATE KEY UPDATE
            plan_name = VALUES(plan_name),
            monthly_price = VALUES(monthly_price),
            max_profiles = VALUES(max_profiles),
            max_stream_quality = VALUES(max_stream_quality)
    `;

    await pool.query(seedPlansQuery);
};

const ensureAdminProAccess = async () => {
    try {
        const [users] = await pool.query(
            'SELECT user_id FROM USERS WHERE LOWER(email) = ? LIMIT 1',
            [ADMIN_EMAIL]
        );

        if (users.length === 0) return;

        const userId = users[0].user_id;

        await pool.query(
            "UPDATE USERS SET role = 'admin', subscription_status = 'active' WHERE user_id = ?",
            [userId]
        );

        const [planRows] = await pool.query(
            "SELECT plan_id, monthly_price FROM SUBSCRIPTION_PLANS WHERE plan_code = 'pro' LIMIT 1"
        );

        if (planRows.length === 0) return;

        const { plan_id, monthly_price } = planRows[0];
        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setMonth(expiresAt.getMonth() + 1);

        await pool.query(
            "UPDATE USER_SUBSCRIPTIONS SET status = 'inactive' WHERE user_id = ? AND status = 'active'",
            [userId]
        );

        const [subscriptionInsert] = await pool.query(
            `INSERT INTO USER_SUBSCRIPTIONS (user_id, plan_id, status, started_at, expires_at, auto_renew)
             VALUES (?, ?, 'active', ?, ?, TRUE)`,
            [userId, plan_id, now, expiresAt]
        );

        await pool.query(
            `INSERT INTO SUBSCRIPTION_PAYMENTS (subscription_id, amount, currency, billing_cycle, payment_status, payment_date, transaction_reference)
             VALUES (?, ?, 'USD', 'monthly', 'paid', ?, ?)`,
            [subscriptionInsert.insertId, monthly_price, now, `ADMIN-PRO-${userId}-${Date.now()}`]
        );
    } catch (error) {
        console.error('Admin Pro Bootstrap Error:', error);
    }
};

// Test Route to verify DB Connection
app.get('/api/status', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        res.json({ message: 'Backend is running and connected to MySQL OmniHub Database!' });
        connection.release();
    } catch (error) {
        res.status(500).json({ error: 'Database connection failed', details: error.message });
    }
});

// ==========================================
// AUTH ROUTES (JWT)
// ==========================================
app.post('/api/auth/register', async (req, res) => {
    const { full_name, email, password } = req.body;

    if (!full_name || !email || !password) {
        return res.status(400).json({ error: 'full_name, email, and password are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    try {
        const [existing] = await pool.query('SELECT user_id FROM USERS WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        const [insertUser] = await pool.query(
            'INSERT INTO USERS (full_name, email, password_hash, role, subscription_status) VALUES (?, ?, ?, ?, ?)',
            [full_name, email, passwordHash, String(email).toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user', 'active']
        );

        await pool.query(
            'INSERT INTO PROFILES (user_id, profile_name, maturity_level) VALUES (?, ?, ?)',
            [insertUser.insertId, `${full_name.split(' ')[0]} Profile`, 'adults']
        );

        const [basicPlanRows] = await pool.query('SELECT plan_id FROM SUBSCRIPTION_PLANS WHERE plan_code = ? LIMIT 1', ['basic']);
        if (basicPlanRows.length > 0) {
            const now = new Date();
            const expiresAt = new Date(now);
            expiresAt.setMonth(expiresAt.getMonth() + 1);

            const [subscriptionResult] = await pool.query(
                'INSERT INTO USER_SUBSCRIPTIONS (user_id, plan_id, status, started_at, expires_at, auto_renew) VALUES (?, ?, ?, ?, ?, ?)',
                [insertUser.insertId, basicPlanRows[0].plan_id, 'active', now, expiresAt, true]
            );

            await pool.query(
                'INSERT INTO SUBSCRIPTION_PAYMENTS (subscription_id, amount, currency, billing_cycle, payment_status, payment_date, transaction_reference) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [subscriptionResult.insertId, 7.99, 'USD', 'monthly', 'paid', now, `REG-${insertUser.insertId}-${Date.now()}`]
            );
        }

        const userPayload = { user_id: insertUser.insertId, email };
        const token = generateToken(userPayload);

        res.status(201).json({
            token,
            user: {
                user_id: insertUser.insertId,
                full_name,
                email,
                role: String(email).toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user',
                subscription_status: 'active'
            }
        });
    } catch (error) {
        console.error('Register Error:', error);
        res.status(500).json({ error: 'Failed to register user' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }

    try {
        const [rows] = await pool.query(
            'SELECT user_id, full_name, email, password_hash, role, subscription_status FROM USERS WHERE email = ? LIMIT 1',
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = generateToken(user);
        res.json({
            token,
            user: {
                user_id: user.user_id,
                full_name: user.full_name,
                email: user.email,
                role: user.role || 'user',
                subscription_status: user.subscription_status
            }
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Failed to login' });
    }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT user_id, full_name, email, role, subscription_status, created_at FROM USERS WHERE user_id = ? LIMIT 1',
            [req.user.user_id]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const [profiles] = await pool.query(
            'SELECT profile_id, profile_name, maturity_level FROM PROFILES WHERE user_id = ? ORDER BY profile_id ASC',
            [req.user.user_id]
        );

        const [subscription] = await pool.query(
            `SELECT us.subscription_id, us.status, us.started_at, us.expires_at, sp.plan_code, sp.plan_name, sp.monthly_price
             FROM USER_SUBSCRIPTIONS us
             JOIN SUBSCRIPTION_PLANS sp ON us.plan_id = sp.plan_id
             WHERE us.user_id = ?
             ORDER BY us.subscription_id DESC
             LIMIT 1`,
            [req.user.user_id]
        );

        res.json({ user: users[0], profiles, subscription: subscription[0] || null });
    } catch (error) {
        console.error('Auth Me Error:', error);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

app.get('/api/subscription/plans', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT plan_id, plan_code, plan_name, monthly_price, max_profiles, max_stream_quality FROM SUBSCRIPTION_PLANS ORDER BY monthly_price ASC'
        );
        res.json(rows);
    } catch (error) {
        console.error('Plans Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch plans' });
    }
});

app.post('/api/subscription/requests', authenticate, async (req, res) => {
    const { plan_code, payment_method = 'mock-card', payment_reference = null } = req.body;

    if (!plan_code) {
        return res.status(400).json({ error: 'plan_code is required' });
    }

    try {
        const [planRows] = await pool.query(
            'SELECT plan_id, plan_name, monthly_price FROM SUBSCRIPTION_PLANS WHERE plan_code = ? LIMIT 1',
            [plan_code]
        );

        if (planRows.length === 0) {
            return res.status(404).json({ error: 'Plan not found' });
        }

        const plan = planRows[0];

        const [result] = await pool.query(
            `INSERT INTO SUBSCRIPTION_REQUESTS (user_id, plan_id, payment_method, payment_reference, payment_amount, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [req.user.user_id, plan.plan_id, payment_method, payment_reference || `MOCK-${Date.now()}`, plan.monthly_price]
        );

        res.status(201).json({
            message: 'Subscription request submitted. Your subscription will be active soon after admin approval.',
            request_id: result.insertId,
            plan: { plan_code, plan_name: plan.plan_name }
        });
    } catch (error) {
        console.error('Subscription Request Error:', error);
        res.status(500).json({ error: 'Failed to create subscription request' });
    }
});

app.get('/api/subscription/requests/my', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT sr.request_id, sr.status, sr.payment_method, sr.payment_reference, sr.payment_amount, sr.created_at, sr.approved_at,
                    sp.plan_code, sp.plan_name
             FROM SUBSCRIPTION_REQUESTS sr
             JOIN SUBSCRIPTION_PLANS sp ON sr.plan_id = sp.plan_id
             WHERE sr.user_id = ?
             ORDER BY sr.created_at DESC`,
            [req.user.user_id]
        );
        res.json(rows);
    } catch (error) {
        console.error('My Subscription Requests Error:', error);
        res.status(500).json({ error: 'Failed to fetch subscription requests' });
    }
});

app.get('/api/subscription/requests/pending', authenticate, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT sr.request_id, sr.user_id, sr.status, sr.payment_method, sr.payment_reference, sr.payment_amount, sr.created_at,
                    u.full_name, u.email, sp.plan_code, sp.plan_name
             FROM SUBSCRIPTION_REQUESTS sr
             JOIN USERS u ON sr.user_id = u.user_id
             JOIN SUBSCRIPTION_PLANS sp ON sr.plan_id = sp.plan_id
             WHERE sr.status = 'pending'
             ORDER BY sr.created_at ASC`
        );
        res.json(rows);
    } catch (error) {
        console.error('Pending Requests Error:', error);
        res.status(500).json({ error: 'Failed to fetch pending requests' });
    }
});

app.post('/api/subscription/requests/:requestId/approve', authenticate, requireAdmin, async (req, res) => {
    const requestId = Number(req.params.requestId);
    if (!Number.isFinite(requestId)) {
        return res.status(400).json({ error: 'Invalid request id' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [requestRows] = await connection.query(
            `SELECT sr.request_id, sr.user_id, sr.payment_reference, sr.payment_amount, sr.status,
                    sp.plan_id, sp.plan_code
             FROM SUBSCRIPTION_REQUESTS sr
             JOIN SUBSCRIPTION_PLANS sp ON sr.plan_id = sp.plan_id
             WHERE sr.request_id = ?
             FOR UPDATE`,
            [requestId]
        );

        if (requestRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Subscription request not found' });
        }

        const requestRow = requestRows[0];
        if (requestRow.status !== 'pending') {
            await connection.rollback();
            return res.status(400).json({ error: `Request already ${requestRow.status}` });
        }

        await connection.query(
            "UPDATE USER_SUBSCRIPTIONS SET status = 'inactive' WHERE user_id = ? AND status = 'active'",
            [requestRow.user_id]
        );

        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setMonth(expiresAt.getMonth() + 1);

        const [subscriptionInsert] = await connection.query(
            `INSERT INTO USER_SUBSCRIPTIONS (user_id, plan_id, status, started_at, expires_at, auto_renew)
             VALUES (?, ?, 'active', ?, ?, TRUE)`,
            [requestRow.user_id, requestRow.plan_id, now, expiresAt]
        );

        await connection.query(
            `INSERT INTO SUBSCRIPTION_PAYMENTS (subscription_id, amount, currency, billing_cycle, payment_status, payment_date, transaction_reference)
             VALUES (?, ?, 'USD', 'monthly', 'paid', ?, ?)`,
            [subscriptionInsert.insertId, requestRow.payment_amount, now, requestRow.payment_reference || `APPROVED-${Date.now()}`]
        );

        await connection.query(
            "UPDATE USERS SET subscription_status = 'active' WHERE user_id = ?",
            [requestRow.user_id]
        );

        await connection.query(
            `UPDATE SUBSCRIPTION_REQUESTS
             SET status = 'approved', approved_by = ?, approved_at = ?
             WHERE request_id = ?`,
            [req.user.user_id, now, requestId]
        );

        await connection.commit();
        res.json({ success: true, message: 'Subscription approved and activated' });
    } catch (error) {
        await connection.rollback();
        console.error('Approve Subscription Error:', error);
        res.status(500).json({ error: 'Failed to approve subscription' });
    } finally {
        connection.release();
    }
});

app.get('/api/profiles', authenticate, async (req, res) => {
    try {
        const [profiles] = await pool.query(
            'SELECT profile_id, profile_name, maturity_level, created_at FROM PROFILES WHERE user_id = ? ORDER BY profile_id ASC',
            [req.user.user_id]
        );
        res.json(profiles);
    } catch (error) {
        console.error('Profiles Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch profiles' });
    }
});

app.post('/api/profiles', authenticate, async (req, res) => {
    const { profile_name, maturity_level = 'adults' } = req.body;

    if (!profile_name || String(profile_name).trim().length < 2) {
        return res.status(400).json({ error: 'profile_name must be at least 2 characters' });
    }

    if (!['kids', 'teens', 'adults'].includes(maturity_level)) {
        return res.status(400).json({ error: 'Invalid maturity_level' });
    }

    try {
        const [subscriptionRows] = await pool.query(
            `SELECT sp.max_profiles
             FROM USER_SUBSCRIPTIONS us
             JOIN SUBSCRIPTION_PLANS sp ON us.plan_id = sp.plan_id
             WHERE us.user_id = ? AND us.status = 'active'
             ORDER BY us.subscription_id DESC
             LIMIT 1`,
            [req.user.user_id]
        );

        const maxProfiles = subscriptionRows[0]?.max_profiles ?? 1;

        const [countRows] = await pool.query(
            'SELECT COUNT(*) AS profile_count FROM PROFILES WHERE user_id = ?',
            [req.user.user_id]
        );

        if (countRows[0].profile_count >= maxProfiles) {
            return res.status(400).json({ error: `Profile limit reached for your plan (${maxProfiles})` });
        }

        const [insertResult] = await pool.query(
            'INSERT INTO PROFILES (user_id, profile_name, maturity_level) VALUES (?, ?, ?)',
            [req.user.user_id, String(profile_name).trim(), maturity_level]
        );

        res.status(201).json({
            profile_id: insertResult.insertId,
            profile_name: String(profile_name).trim(),
            maturity_level
        });
    } catch (error) {
        console.error('Profile Create Error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Profile name already exists for this user' });
        }
        res.status(500).json({ error: 'Failed to create profile' });
    }
});

// ==========================================
// 1. SEARCH ROUTE (Phase 1: Fast Search)
// ==========================================
app.get('/api/search', async (req, res) => {
    const query = req.query.query;
    
    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }

    try {
        const tmdbUrl = buildTmdbUrl('/search/multi', { query });
        const response = await fetch(tmdbUrl);
        const data = await response.json();

        // Send the lightweight results directly to the frontend
        res.json(data.results);
    } catch (error) {
        console.error("Search Error:", error);
        res.status(500).json({ error: 'Failed to fetch search data from TMDB' });
    }
});

// ==========================================
// 2. SMART DETAILS ROUTE (Phase 2: Lazy Loading & Caching)
// ==========================================
app.get('/api/movies/:id', async (req, res) => {
    const tmdbId = req.params.id;

    try {
        // Step A: Check if the movie already exists in your MySQL database
        const [rows] = await pool.query('SELECT * FROM CONTENT WHERE tmdb_id = ?', [tmdbId]);

        if (rows.length > 0) {
            console.log(`[CACHE HIT] Serving "${rows[0].title}" from MySQL Database`);
            return res.json(rows[0]);
        }

        // Step B: If not in MySQL, fetch the heavy details from TMDB
        console.log(`[CACHE MISS] Fetching ID ${tmdbId} from TMDB API`);
        const tmdbUrl = buildTmdbUrl(`/movie/${tmdbId}`);
        const response = await fetch(tmdbUrl);
        const tmdbData = await response.json();

        if (tmdbData.success === false) {
            return res.status(404).json({ error: 'Movie not found on TMDB' });
        }

        // Step C: Save this new movie into your MySQL database
        const insertQuery = `
            INSERT INTO CONTENT (tmdb_id, title, description, release_year, poster_url, content_type)
            VALUES (?, ?, ?, ?, ?, 'Movie')
        `;
        
        // Extract just the year from "YYYY-MM-DD"
        const year = tmdbData.release_date ? tmdbData.release_date.split('-')[0] : null;

        const [result] = await pool.query(insertQuery, [
            tmdbData.id,
            tmdbData.title,
            tmdbData.overview,
            year,
            tmdbData.poster_path
        ]);

        console.log(`[SAVED] Saved "${tmdbData.title}" to MySQL successfully!`);

        // Step D: Send the newly saved data back to the frontend
        res.json({
            content_id: result.insertId,
            tmdb_id: tmdbData.id,
            title: tmdbData.title,
            description: tmdbData.overview,
            release_year: year,
            poster_url: tmdbData.poster_path,
            content_type: 'Movie'
        });

    } catch (error) {
        console.error("Details Route Error:", error);
        res.status(500).json({ error: 'Server error while fetching or saving movie details' });
    }
});

// ==========================================
// 3. FAVORITES ROUTES (DB-backed)
// ==========================================
app.get('/api/favorites', authenticate, async (req, res) => {
    const profileId = Number(req.query.profile_id);

    try {
        const validatedProfileId = await getValidatedProfileId(req.user.user_id, profileId);
        if (!validatedProfileId) {
            return res.status(400).json({ error: 'Valid profile_id is required for favorites' });
        }

        const [rows] = await pool.query(
            `SELECT favorite_id, tmdb_id, media_type, title, poster_path, vote_average, created_at, profile_id
             FROM USER_FAVORITES
             WHERE user_id = ? AND profile_id = ?
             ORDER BY created_at DESC`,
            [req.user.user_id, validatedProfileId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Favorites Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch favorites' });
    }
});

app.post('/api/favorites', authenticate, async (req, res) => {
    const { profile_id, tmdb_id, media_type, title, poster_path, vote_average } = req.body;

    if (!profile_id || !tmdb_id || !media_type || !title) {
        return res.status(400).json({ error: 'profile_id, tmdb_id, media_type, and title are required' });
    }

    try {
        const validatedProfileId = await getValidatedProfileId(req.user.user_id, profile_id);
        if (!validatedProfileId) {
            return res.status(400).json({ error: 'Invalid profile_id for this user' });
        }

        const upsertResult = await upsertMediaContent(tmdb_id, media_type);
        const persistedTitle = upsertResult?.tmdbData
            ? (media_type === 'movie' ? upsertResult.tmdbData.title : upsertResult.tmdbData.name)
            : title;
        const persistedPoster = upsertResult?.tmdbData?.poster_path || poster_path || null;
        const persistedVote = upsertResult?.tmdbData?.vote_average ?? vote_average ?? null;

        const insertQuery = `
            INSERT INTO USER_FAVORITES (user_id, profile_id, tmdb_id, media_type, title, poster_path, vote_average)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                media_type = VALUES(media_type),
                title = VALUES(title),
                poster_path = VALUES(poster_path),
                vote_average = VALUES(vote_average)
        `;

        await pool.query(insertQuery, [
            req.user.user_id,
            validatedProfileId,
            tmdb_id,
            media_type,
            persistedTitle || title,
            persistedPoster,
            persistedVote
        ]);

        res.json({ success: true, message: 'Favorite saved' });
    } catch (error) {
        console.error('Favorite Save Error:', error);
        res.status(500).json({ error: 'Failed to save favorite' });
    }
});

app.delete('/api/favorites/:tmdbId', authenticate, async (req, res) => {
    const tmdbId = Number(req.params.tmdbId);
    const mediaType = req.query.media_type;
    const profileId = Number(req.query.profile_id);

    if (!Number.isFinite(tmdbId)) {
        return res.status(400).json({ error: 'Invalid tmdb id' });
    }

    if (!mediaType || !['movie', 'tv'].includes(mediaType)) {
        return res.status(400).json({ error: 'Valid media_type query parameter is required' });
    }

    try {
        const validatedProfileId = await getValidatedProfileId(req.user.user_id, profileId);
        if (!validatedProfileId) {
            return res.status(400).json({ error: 'Valid profile_id query parameter is required' });
        }

        const [result] = await pool.query(
            'DELETE FROM USER_FAVORITES WHERE user_id = ? AND profile_id = ? AND tmdb_id = ? AND media_type = ?',
            [req.user.user_id, validatedProfileId, tmdbId, mediaType]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Favorite not found' });
        }
        res.json({ success: true, message: 'Favorite removed' });
    } catch (error) {
        console.error('Favorite Delete Error:', error);
        res.status(500).json({ error: 'Failed to delete favorite' });
    }
});

// ==========================================
// 4. WATCH HISTORY ROUTES
// ==========================================
app.post('/api/watch-history', authenticate, async (req, res) => {
    const {
        profile_id = null,
        tmdb_id,
        media_type,
        season_number = null,
        episode_number = null,
        duration_watched_seconds = 0,
        duration_total_seconds = 0,
        completed = false
    } = req.body;

    if (!tmdb_id || !media_type || !['movie', 'tv'].includes(media_type)) {
        return res.status(400).json({ error: 'Valid tmdb_id and media_type are required' });
    }

    try {
        const validatedProfileId = await getValidatedProfileId(req.user.user_id, profile_id);
        if (!validatedProfileId) {
            return res.status(400).json({ error: 'Valid profile_id is required for watch history' });
        }

        const upsertResult = await upsertMediaContent(tmdb_id, media_type);
        if (media_type === 'tv' && upsertResult?.contentId && season_number && episode_number) {
            await upsertEpisodeDetails(upsertResult.contentId, tmdb_id, season_number, episode_number);
        }

        const insertQuery = `
            INSERT INTO WATCH_HISTORY (
                user_id, profile_id, tmdb_id, media_type, season_number, episode_number,
                duration_watched_seconds, duration_total_seconds, completed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await pool.query(insertQuery, [
            req.user.user_id,
            validatedProfileId,
            tmdb_id,
            media_type,
            season_number,
            episode_number,
            duration_watched_seconds,
            duration_total_seconds,
            completed
        ]);

        const safeDuration = Number(duration_watched_seconds || 0);
        const safeTotal = Number(duration_total_seconds || 0);

        const progressUpsertQuery = `
            INSERT INTO WATCH_PROGRESS (
                user_id, profile_id, tmdb_id, media_type, season_number, episode_number,
                last_position_seconds, total_watched_seconds, completed, last_watched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                last_position_seconds = VALUES(last_position_seconds),
                total_watched_seconds = GREATEST(total_watched_seconds, 0) + VALUES(total_watched_seconds),
                completed = VALUES(completed),
                last_watched_at = NOW()
        `;

        await pool.query(progressUpsertQuery, [
            req.user.user_id,
            validatedProfileId,
            tmdb_id,
            media_type,
            season_number,
            episode_number,
            safeDuration,
            safeDuration,
            completed
        ]);

        res.status(201).json({ success: true, message: 'Watch history recorded' });
    } catch (error) {
        console.error('Watch History Save Error:', error);
        res.status(500).json({ error: 'Failed to save watch history' });
    }
});

app.get('/api/watch-history', authenticate, async (req, res) => {
    const limit = Number(req.query.limit || 30);
    const profileId = Number(req.query.profile_id);
    const detailed = String(req.query.detailed || 'false').toLowerCase() === 'true';

    try {
        const validatedProfileId = await getValidatedProfileId(req.user.user_id, profileId);
        if (!validatedProfileId) {
            return res.status(400).json({ error: 'Valid profile_id query parameter is required' });
        }

        if (!detailed) {
            const [rows] = await pool.query(
                `SELECT wp.progress_id AS watch_id, wp.tmdb_id, wp.media_type, wp.season_number, wp.episode_number,
                        wp.last_watched_at AS watched_at, wp.last_position_seconds AS duration_watched_seconds,
                        wp.total_watched_seconds AS duration_total_seconds, wp.completed,
                        p.profile_name, mc.title, mc.poster_path, mc.release_date, mc.content_type,
                        wp.last_position_seconds
                 FROM WATCH_PROGRESS wp
                 LEFT JOIN PROFILES p ON wp.profile_id = p.profile_id
                 LEFT JOIN MEDIA_CONTENT mc ON wp.tmdb_id = mc.tmdb_id
                 WHERE wp.user_id = ? AND wp.profile_id = ?
                 ORDER BY wp.last_watched_at DESC
                 LIMIT ?`,
                [req.user.user_id, validatedProfileId, limit]
            );
            return res.json(rows);
        }

        const [rows] = await pool.query(
            `SELECT watch_id, tmdb_id, media_type, season_number, episode_number,
                    watched_at, duration_watched_seconds, duration_total_seconds, completed,
                  p.profile_name,
                  mc.title,
                  mc.poster_path,
                  mc.release_date,
                  mc.content_type
             FROM WATCH_HISTORY wh
             LEFT JOIN PROFILES p ON wh.profile_id = p.profile_id
              LEFT JOIN MEDIA_CONTENT mc ON wh.tmdb_id = mc.tmdb_id
             WHERE wh.user_id = ? AND wh.profile_id = ?
             ORDER BY watched_at DESC
             LIMIT ?`,
            [req.user.user_id, validatedProfileId, limit]
        );
        res.json(rows);
    } catch (error) {
        console.error('Watch History Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch watch history' });
    }
});

app.post('/api/watch-progress', authenticate, async (req, res) => {
    const {
        profile_id,
        tmdb_id,
        media_type,
        season_number = null,
        episode_number = null,
        last_position_seconds = 0,
        completed = false
    } = req.body;

    if (!profile_id || !tmdb_id || !media_type || !['movie', 'tv'].includes(media_type)) {
        return res.status(400).json({ error: 'profile_id, tmdb_id and valid media_type are required' });
    }

    try {
        const validatedProfileId = await getValidatedProfileId(req.user.user_id, profile_id);
        if (!validatedProfileId) {
            return res.status(400).json({ error: 'Invalid profile_id for this user' });
        }

        const progress = Math.max(0, Number(last_position_seconds || 0));

        await upsertMediaContent(tmdb_id, media_type);

        const upsertQuery = `
            INSERT INTO WATCH_PROGRESS (
                user_id, profile_id, tmdb_id, media_type, season_number, episode_number,
                last_position_seconds, total_watched_seconds, completed, last_watched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                last_position_seconds = VALUES(last_position_seconds),
                total_watched_seconds = GREATEST(total_watched_seconds, VALUES(total_watched_seconds)),
                completed = VALUES(completed),
                last_watched_at = NOW()
        `;

        await pool.query(upsertQuery, [
            req.user.user_id,
            validatedProfileId,
            tmdb_id,
            media_type,
            season_number,
            episode_number,
            progress,
            progress,
            completed
        ]);

        res.json({ success: true, message: 'Progress updated' });
    } catch (error) {
        console.error('Watch Progress Save Error:', error);
        res.status(500).json({ error: 'Failed to update progress' });
    }
});

// ==========================================
// 5. RATINGS / REVIEWS ROUTES
// ==========================================
app.post('/api/ratings', authenticate, async (req, res) => {
    const { tmdb_id, media_type, rating_value, review_text = null } = req.body;

    if (!tmdb_id || !media_type || !['movie', 'tv'].includes(media_type)) {
        return res.status(400).json({ error: 'Valid tmdb_id and media_type are required' });
    }

    const numericRating = Number(rating_value);
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
        return res.status(400).json({ error: 'rating_value must be between 1 and 5' });
    }

    try {
        await upsertMediaContent(tmdb_id, media_type);

        const upsertQuery = `
            INSERT INTO RATINGS_REVIEWS (user_id, tmdb_id, media_type, rating_value, review_text)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                rating_value = VALUES(rating_value),
                review_text = VALUES(review_text)
        `;

        await pool.query(upsertQuery, [
            req.user.user_id,
            tmdb_id,
            media_type,
            numericRating,
            review_text
        ]);

        res.json({ success: true, message: 'Rating saved' });
    } catch (error) {
        console.error('Rating Save Error:', error);
        res.status(500).json({ error: 'Failed to save rating' });
    }
});

app.get('/api/ratings/:tmdbId', async (req, res) => {
    const tmdbId = Number(req.params.tmdbId);
    const mediaType = req.query.media_type;

    if (!Number.isFinite(tmdbId) || !mediaType || !['movie', 'tv'].includes(mediaType)) {
        return res.status(400).json({ error: 'Valid tmdb id and media_type are required' });
    }

    try {
        const [summaryRows] = await pool.query(
            `SELECT ROUND(AVG(rating_value), 2) AS average_rating, COUNT(*) AS total_ratings
             FROM RATINGS_REVIEWS WHERE tmdb_id = ? AND media_type = ?`,
            [tmdbId, mediaType]
        );

        const [recentRows] = await pool.query(
            `SELECT rr.rating_id, rr.rating_value, rr.review_text, rr.created_at, u.full_name
             FROM RATINGS_REVIEWS rr
             JOIN USERS u ON rr.user_id = u.user_id
             WHERE rr.tmdb_id = ? AND rr.media_type = ?
             ORDER BY rr.created_at DESC
             LIMIT 20`,
            [tmdbId, mediaType]
        );

        res.json({
            summary: summaryRows[0],
            reviews: recentRows
        });
    } catch (error) {
        console.error('Ratings Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch ratings' });
    }
});

app.get('/api/ratings/:tmdbId/me', authenticate, async (req, res) => {
    const tmdbId = Number(req.params.tmdbId);
    const mediaType = req.query.media_type;

    if (!Number.isFinite(tmdbId) || !mediaType || !['movie', 'tv'].includes(mediaType)) {
        return res.status(400).json({ error: 'Valid tmdb id and media_type are required' });
    }

    try {
        const [rows] = await pool.query(
            `SELECT rating_id, rating_value, review_text, created_at, updated_at
             FROM RATINGS_REVIEWS
             WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
             LIMIT 1`,
            [req.user.user_id, tmdbId, mediaType]
        );

        res.json(rows[0] || null);
    } catch (error) {
        console.error('My Rating Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch your rating' });
    }
});

// Start the server
const PORT = process.env.PORT || 5000;
initDatabase()
    .then(() => ensureAdminProAccess())
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch((error) => {
        console.error('Database initialization failed:', error);
        process.exit(1);
    });