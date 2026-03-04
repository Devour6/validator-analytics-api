# SSL Certificate Setup for Validator Analytics API

This document explains how to set up SSL certificates for the mainnet deployment.

## ⚠️ Security Notice

SSL certificates and private keys should **NEVER** be committed to the repository. This is a major security risk.

## Certificate Requirements

The nginx configuration expects SSL certificates to be placed in the following locations:
- Certificate: `/etc/nginx/ssl/validator-analytics.pem`
- Private Key: `/etc/nginx/ssl/validator-analytics.key`

## Setup Methods

### Option 1: Manual Certificate Placement

1. Obtain SSL certificates for your domains:
   - `validator-analytics-api.phase.com`
   - `validator-analytics.phase.com`

2. Create the SSL directory:
   ```bash
   mkdir -p nginx/ssl
   ```

3. Copy your certificates:
   ```bash
   cp /path/to/your/certificate.pem nginx/ssl/validator-analytics.pem
   cp /path/to/your/private-key.key nginx/ssl/validator-analytics.key
   ```

4. Set proper permissions:
   ```bash
   chmod 600 nginx/ssl/validator-analytics.key
   chmod 644 nginx/ssl/validator-analytics.pem
   ```

### Option 2: Let's Encrypt with Certbot

1. Install certbot:
   ```bash
   sudo apt-get update
   sudo apt-get install certbot
   ```

2. Generate certificates:
   ```bash
   sudo certbot certonly --standalone \
     -d validator-analytics-api.phase.com \
     -d validator-analytics.phase.com \
     --email your-email@phase.com \
     --agree-tos \
     --non-interactive
   ```

3. Copy certificates to nginx directory:
   ```bash
   sudo cp /etc/letsencrypt/live/validator-analytics-api.phase.com/fullchain.pem nginx/ssl/validator-analytics.pem
   sudo cp /etc/letsencrypt/live/validator-analytics-api.phase.com/privkey.pem nginx/ssl/validator-analytics.key
   ```

4. Set up automatic renewal:
   ```bash
   sudo crontab -e
   # Add this line:
   0 12 * * * /usr/bin/certbot renew --quiet --post-hook "docker-compose -f /path/to/docker-compose.mainnet.yml restart nginx"
   ```

### Option 3: Docker Volume Mount (Recommended)

Mount certificates from the host system using Docker volumes:

1. Place certificates on the host:
   ```bash
   sudo mkdir -p /etc/ssl/validator-analytics
   sudo cp your-certificate.pem /etc/ssl/validator-analytics/validator-analytics.pem
   sudo cp your-private-key.key /etc/ssl/validator-analytics/validator-analytics.key
   sudo chmod 600 /etc/ssl/validator-analytics/validator-analytics.key
   sudo chmod 644 /etc/ssl/validator-analytics/validator-analytics.pem
   ```

2. Update docker-compose.mainnet.yml to mount from host:
   ```yaml
   nginx:
     # ... other configuration
     volumes:
       - /etc/ssl/validator-analytics:/etc/nginx/ssl:ro
       # ... other volumes
   ```

## Certificate Validation

Before deployment, validate your certificates:

```bash
# Check certificate expiration
openssl x509 -in nginx/ssl/validator-analytics.pem -noout -dates

# Verify certificate matches private key
openssl x509 -noout -modulus -in nginx/ssl/validator-analytics.pem | openssl md5
openssl rsa -noout -modulus -in nginx/ssl/validator-analytics.key | openssl md5

# Check certificate details
openssl x509 -in nginx/ssl/validator-analytics.pem -text -noout
```

## Deployment Notes

1. **Never commit**: SSL certificates are added to `.gitignore` to prevent accidental commits
2. **File permissions**: Ensure private keys have restricted permissions (600)
3. **Domain validation**: Verify certificates match your domain names
4. **Expiration monitoring**: Set up monitoring for certificate expiration

## Troubleshooting

### Common Issues

1. **Permission denied errors**:
   ```bash
   sudo chown root:root nginx/ssl/*
   sudo chmod 600 nginx/ssl/validator-analytics.key
   sudo chmod 644 nginx/ssl/validator-analytics.pem
   ```

2. **Certificate mismatch**:
   Ensure the certificate includes all required domains or use a wildcard certificate.

3. **Let's Encrypt rate limits**:
   Let's Encrypt has rate limits. Use staging environment for testing:
   ```bash
   certbot --staging --standalone -d your-domain.com
   ```

## Security Best Practices

- Use strong encryption (TLS 1.2+ only, strong cipher suites)
- Implement HSTS headers (already configured in nginx)
- Monitor certificate expiration
- Use proper file permissions
- Regular security audits
- Certificate transparency monitoring

## Support

For certificate-related issues:
1. Check nginx error logs: `docker-compose logs nginx`
2. Validate certificate setup using the commands above
3. Ensure DNS records point to your server
4. Verify firewall allows HTTPS traffic (port 443)