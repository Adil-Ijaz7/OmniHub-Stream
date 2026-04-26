-- OmniHub Streaming Service Database Schema
-- MySQL 8+

CREATE DATABASE IF NOT EXISTS omnihub_streaming;
USE omnihub_streaming;

CREATE TABLE IF NOT EXISTS USERS (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(191) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    subscription_status ENUM('active', 'inactive', 'suspended') DEFAULT 'inactive',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS PROFILES (
    profile_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    profile_name VARCHAR(80) NOT NULL,
    maturity_level ENUM('kids', 'teens', 'adults') DEFAULT 'adults',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_profile_name (user_id, profile_name)
);

CREATE TABLE IF NOT EXISTS SUBSCRIPTION_PLANS (
    plan_id INT AUTO_INCREMENT PRIMARY KEY,
    plan_code VARCHAR(50) NOT NULL UNIQUE,
    plan_name VARCHAR(80) NOT NULL,
    monthly_price DECIMAL(10,2) NOT NULL,
    max_profiles INT NOT NULL DEFAULT 1,
    max_stream_quality VARCHAR(20) DEFAULT 'HD'
);

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
);

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
);

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
);

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
);

CREATE TABLE IF NOT EXISTS GENRES (
    genre_id INT AUTO_INCREMENT PRIMARY KEY,
    genre_name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS CONTENT_GENRES (
    content_id INT NOT NULL,
    genre_id INT NOT NULL,
    PRIMARY KEY (content_id, genre_id),
    FOREIGN KEY (content_id) REFERENCES MEDIA_CONTENT(content_id) ON DELETE CASCADE,
    FOREIGN KEY (genre_id) REFERENCES GENRES(genre_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS PEOPLE (
    person_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    tmdb_person_id INT UNIQUE,
    profession ENUM('actor', 'director', 'writer', 'producer', 'other') DEFAULT 'actor'
);

CREATE TABLE IF NOT EXISTS CONTENT_CAST (
    content_id INT NOT NULL,
    person_id INT NOT NULL,
    role_name VARCHAR(255),
    billing_order INT,
    PRIMARY KEY (content_id, person_id),
    FOREIGN KEY (content_id) REFERENCES MEDIA_CONTENT(content_id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES PEOPLE(person_id) ON DELETE CASCADE
);

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
);

CREATE TABLE IF NOT EXISTS RATINGS_REVIEWS (
    rating_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    tmdb_id INT NOT NULL,
    media_type ENUM('movie', 'tv') NOT NULL,
    rating_value DECIMAL(2,1) NOT NULL,
    review_text TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_rating_range CHECK (rating_value >= 1.0 AND rating_value <= 5.0),
    UNIQUE KEY uq_user_content_rating (user_id, tmdb_id, media_type),
    FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE
);

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
);

CREATE TABLE IF NOT EXISTS WATCHLIST (
    watchlist_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    tmdb_id INT NOT NULL,
    media_type ENUM('movie', 'tv') NOT NULL,
    title VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_watchlist (user_id, tmdb_id, media_type),
    FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS CONTENT (
    content_id INT AUTO_INCREMENT PRIMARY KEY,
    tmdb_id INT NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    release_year INT,
    poster_url VARCHAR(255),
    content_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO SUBSCRIPTION_PLANS (plan_code, plan_name, monthly_price, max_profiles, max_stream_quality)
VALUES
    ('basic', 'Basic', 7.99, 1, 'HD'),
    ('standard', 'Standard', 12.99, 3, 'Full HD'),
    ('premium', 'Premium', 17.99, 5, '4K')
ON DUPLICATE KEY UPDATE
    plan_name = VALUES(plan_name),
    monthly_price = VALUES(monthly_price),
    max_profiles = VALUES(max_profiles),
    max_stream_quality = VALUES(max_stream_quality);

DELIMITER $$
CREATE TRIGGER trg_watch_history_active_user
BEFORE INSERT ON WATCH_HISTORY
FOR EACH ROW
BEGIN
    DECLARE user_status VARCHAR(20);
    SELECT subscription_status INTO user_status
    FROM USERS
    WHERE user_id = NEW.user_id
    LIMIT 1;

    IF user_status IS NULL OR user_status <> 'active' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Only active subscribers can create watch history records';
    END IF;
END$$
DELIMITER ;

-- Sample Data Scenario
-- 1) Register user in app -> USERS + PROFILES + USER_SUBSCRIPTIONS + SUBSCRIPTION_PAYMENTS
-- 2) Save favorite from app -> USER_FAVORITES
-- 3) Click play in app -> WATCH_HISTORY
-- 4) Submit rating via API -> RATINGS_REVIEWS
