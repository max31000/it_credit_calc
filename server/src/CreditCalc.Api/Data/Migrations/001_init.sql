CREATE TABLE IF NOT EXISTS users (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    telegram_id BIGINT          NOT NULL,
    username    VARCHAR(255)    NULL,
    first_name  VARCHAR(255)    NULL,
    last_name   VARCHAR(255)    NULL,
    photo_url   VARCHAR(512)    NULL,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_telegram_id (telegram_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mortgages (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         BIGINT UNSIGNED NOT NULL,
    title           VARCHAR(120)    NOT NULL,
    bank            VARCHAR(120)    NULL,
    property_price  DECIMAL(15,2)   NOT NULL,
    down_payment    DECIMAL(15,2)   NOT NULL,
    principal       DECIMAL(15,2)   NOT NULL,   -- сумма кредита на дату выдачи
    rate            DECIMAL(6,3)    NOT NULL,   -- годовая ставка на дату выдачи, %
    term_months     INT             NOT NULL,
    started_on      DATE            NOT NULL,
    monthly_payment DECIMAL(15,2)   NULL,       -- аннуитет из договора; NULL → считает фронт
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_mortgages_user (user_id, id),
    CONSTRAINT fk_mortgages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mortgage_events (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    mortgage_id BIGINT UNSIGNED NOT NULL,
    kind        VARCHAR(16)     NOT NULL,   -- balance | rate | prepayment | payment
    occurred_on DATE            NOT NULL,
    amount      DECIMAL(15,2)   NULL,
    rate        DECIMAL(6,3)    NULL,
    note        VARCHAR(500)    NULL,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_events_mortgage (mortgage_id, occurred_on, id),
    CONSTRAINT fk_events_mortgage FOREIGN KEY (mortgage_id) REFERENCES mortgages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
