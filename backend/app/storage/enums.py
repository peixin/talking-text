import enum


class CredentialProvider(str, enum.Enum):
    """Supported login providers for account credentials."""

    EMAIL = "email"
    PHONE = "phone"
    WECHAT = "wechat"
    WEIBO = "weibo"
