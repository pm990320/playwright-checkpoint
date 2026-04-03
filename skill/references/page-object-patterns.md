# Page object patterns with checkpoints

Core rule repeated: **keep checkpoints in test files**. Page objects expose actions/state checks only.

## Pattern 1: Simple page object + milestone checkpoints

```ts
// pages/login-page.ts
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/login');
  }

  async submit(email: string, password: string) {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }
}

// tests/login.spec.ts
import { test, expect } from 'playwright-checkpoint';

test('login happy path @smoke @user-journey', async ({ page, checkpoint }) => {
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await checkpoint('01-login-page', {
    step: 1,
    description: 'Sign-in form is visible and empty.',
    highlightSelector: '#login-form',
  });

  await loginPage.submit('qa@example.com', 'super-secret');
  await expect(page).toHaveURL(/dashboard/);

  await checkpoint('02-dashboard', {
    step: 2,
    description: 'Dashboard home loads with primary widgets.',
    highlightSelector: '[data-testid="dashboard-root"]',
  });
});
```

## Pattern 2: Component object for reusable UI block

```ts
// components/cart-summary.ts
export class CartSummary {
  constructor(private readonly page: Page) {}

  async applyPromo(code: string) {
    await this.page.getByLabel('Promo code').fill(code);
    await this.page.getByRole('button', { name: 'Apply' }).click();
  }

  async totalText() {
    return this.page.getByTestId('order-total').innerText();
  }
}

// tests/checkout.spec.ts
import { test, expect } from 'playwright-checkpoint';

test('promo code changes total @payments', async ({ page, checkpoint }) => {
  const cart = new CartSummary(page);

  await page.goto('/checkout');
  await checkpoint('01-checkout-loaded', {
    step: 1,
    description: 'Checkout page is loaded before promo input.',
    highlightSelector: '[data-testid="order-summary"]',
  });

  await cart.applyPromo('SPRING25');
  await expect(await cart.totalText()).toContain('$');

  await checkpoint('02-promo-applied', {
    step: 2,
    description: 'Order total updates after promo code is applied.',
    highlightSelector: '[data-testid="order-total"]',
    collectors: {
      forms: true,
      network: true,
    },
  });
});
```

## Pattern 3: Multi-page flow object model + targeted debug collectors

```ts
// pages/checkout-flow.ts
export class CheckoutFlow {
  constructor(private readonly page: Page) {}

  async startFromCart() {
    await this.page.goto('/cart');
    await this.page.getByRole('button', { name: 'Checkout' }).click();
  }

  async fillShipping() {
    await this.page.getByLabel('Full name').fill('Ada Lovelace');
    await this.page.getByLabel('Address').fill('1 Test Street');
    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  async submitPayment() {
    await this.page.getByLabel('Card number').fill('4242 4242 4242 4242');
    await this.page.getByRole('button', { name: 'Pay now' }).click();
  }
}

// tests/checkout-flow.spec.ts
import { test, expect } from 'playwright-checkpoint';

test('end-to-end checkout @user-journey @payments', async ({ page, checkpoint, testCheckpointConfig }) => {
  testCheckpointConfig.set({
    collectors: {
      'network-timing': true,
      forms: true,
      storage: true,
    },
  });

  const flow = new CheckoutFlow(page);

  await flow.startFromCart();
  await checkpoint('01-shipping-step', {
    step: 1,
    description: 'Shipping form is visible before user details are entered.',
    highlightSelector: 'form[data-testid="shipping-form"]',
  });

  await flow.fillShipping();
  await checkpoint('02-payment-step', {
    step: 2,
    description: 'Payment form loaded after shipping details submit.',
    highlightSelector: 'form[data-testid="payment-form"]',
  });

  await flow.submitPayment();
  await expect(page.getByText('Order confirmed')).toBeVisible();

  await checkpoint('03-order-confirmed', {
    step: 3,
    description: 'Order confirmation page includes order ID and receipt CTA.',
    highlightSelector: '[data-testid="order-confirmation"]',
  });
});
```

## Anti-patterns to reject in code review

- Checkpoints embedded inside page object methods.
- Page objects with assertions for test outcomes (keep assertions in tests).
- One giant page object for entire app surface.
- Raw locator usage duplicated across tests instead of component/page abstraction.
