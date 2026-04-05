import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HDKey } from '@scure/bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { PrismaService } from '../prisma/prisma.service';

// BIP84 native-segwit extended key version bytes
const MAINNET_ZPUB = { public: 0x04b24746, private: 0x04b2430c }; // zpub / zprv
const TESTNET_ZPUB = { public: 0x045f1cf6, private: 0x045f18bc }; // vpub / vprv

type NetworkMap = Record<string, bitcoin.Network>;

const MAINNET_NETWORKS: NetworkMap = {
  BTC: { ...bitcoin.networks.bitcoin, bip32: MAINNET_ZPUB },
  LTC: {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'ltc',
    bip32: MAINNET_ZPUB,
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0,
  },
};

const TESTNET_NETWORKS: NetworkMap = {
  BTC: { ...bitcoin.networks.testnet, bip32: TESTNET_ZPUB },
  LTC: {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'tltc',
    bip32: TESTNET_ZPUB,
    pubKeyHash: 0x6f,
    scriptHash: 0x3a,
    wif: 0xef,
  },
};

const REGTEST_NETWORKS: NetworkMap = {
  BTC: { ...bitcoin.networks.regtest, bip32: TESTNET_ZPUB },
  LTC: {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'rltc',
    bip32: TESTNET_ZPUB,
    pubKeyHash: 0x6f,
    scriptHash: 0x3a,
    wif: 0xef,
  },
};

const NETWORK_ENV = process.env.NETWORK ?? 'mainnet';
const NETWORKS: NetworkMap =
  NETWORK_ENV === 'testnet' ? TESTNET_NETWORKS
  : NETWORK_ENV === 'regtest' ? REGTEST_NETWORKS
  : MAINNET_NETWORKS;

@Injectable()
export class AddressDerivationService implements OnModuleInit {
  private readonly logger = new Logger(AddressDerivationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const seeds: Record<string, string | undefined> = {
      BTC: process.env.BTC_XPUB,
      LTC: process.env.LTC_XPUB,
    };

    for (const [currency, xpub] of Object.entries(seeds)) {
      if (!xpub) continue;
      await this.prisma.walletConfig.upsert({
        where: { currency },
        create: { currency, xpub, nextIndex: 0 },
        update: { xpub },
      });
      this.logger.log(`WalletConfig seeded for ${currency}`);
    }
  }

  async deriveNextAddress(currency: string): Promise<{ address: string; index: number }> {
    const network = NETWORKS[currency];
    if (!network) throw new Error(`Unsupported currency: ${currency}`);

    // Atomic fetch-and-increment
    const config = await this.prisma.$queryRaw<
      { currency: string; xpub: string; nextIndex: number }[]
    >`
      UPDATE "WalletConfig"
      SET "nextIndex" = "nextIndex" + 1
      WHERE currency = ${currency}
      RETURNING currency, xpub, "nextIndex" - 1 AS "nextIndex"
    `;

    const row = config[0];
    if (!row) throw new Error(`No WalletConfig found for ${currency}`);

    const { xpub, nextIndex } = row;

    // Pass the network's bip32 version bytes so @scure/bip32 accepts zpub/vpub keys
    const versions = { public: network.bip32.public, private: network.bip32.private };
    const root = HDKey.fromExtendedKey(xpub, versions);

    // BIP84 external chain: m/0/index
    const child = root.deriveChild(0).deriveChild(nextIndex);
    if (!child.publicKey) throw new Error('Failed to derive public key');

    const { address } = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(child.publicKey),
      network,
    });

    if (!address) throw new Error(`Failed to derive address for ${currency} index ${nextIndex}`);

    this.logger.log(`Derived ${currency} address index ${nextIndex}: ${address}`);
    return { address, index: nextIndex };
  }
}
