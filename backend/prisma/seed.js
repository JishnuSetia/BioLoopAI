/**
 * BioLoop AI – Prisma seed script
 * Clears existing data and inserts fresh sample users, farms, and industries.
 */
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

async function main() {
  // Clear data in dependency order
  await prisma.match.deleteMany({});
  await prisma.farm.deleteMany({});
  await prisma.industry.deleteMany({});
  await prisma.user.deleteMany({});

  // Create users
  const farmPassword = 'Farm1234!';
  const industryPassword = 'Industry1234!';

  const farmManager = await prisma.user.create({
    data: {
      email: 'farm.manager@bioloop.ai',
      hashed_password: await bcrypt.hash(farmPassword, SALT_ROUNDS),
      role: 'FARM_MANAGER',
    },
  });

  const industryManager = await prisma.user.create({
    data: {
      email: 'industry.manager@bioloop.ai',
      hashed_password: await bcrypt.hash(industryPassword, SALT_ROUNDS),
      role: 'INDUSTRY_MANAGER',
    },
  });

  // Create farms (one owned by farm manager, others unowned for matching)
  await prisma.farm.create({
    data: {
      name: 'Prairie Valley Farm',
      waste_type: 'manure',
      quantity: 1400,
      desired_type: 'organic fertilizer',
      desired_quantity: 320,
      latitude: 50.4452,
      longitude: -104.6189,
      description: 'Mixed livestock operation focused on sustainable manure management.',
      ownerId: farmManager.id,
    },
  });

  await prisma.farm.createMany({
    data: [
      {
        name: 'Regina Grain Collective',
        waste_type: 'crop residue',
        quantity: 900,
        desired_type: 'biomass pellets',
        desired_quantity: 260,
        latitude: 50.4472,
        longitude: -104.6069,
        description: 'Grain collective with consistent residue output.',
      },
      {
        name: 'Red River Co-op',
        waste_type: 'straw',
        quantity: 850,
        desired_type: 'organic fertilizer',
        desired_quantity: 180,
        latitude: 49.8951,
        longitude: -97.1384,
        description: 'Regional grain co-op with surplus straw bales.',
      },
      {
        name: 'Lakeview Organics',
        waste_type: 'manure',
        quantity: 700,
        desired_type: 'biomass pellets',
        desired_quantity: 140,
        latitude: 43.6532,
        longitude: -79.3832,
        description: 'Dairy operation with steady manure output and storage capacity.',
      },
      {
        name: 'Halifax Straw Alliance',
        waste_type: 'straw',
        quantity: 650,
        desired_type: 'organic fertilizer',
        desired_quantity: 120,
        latitude: 44.6488,
        longitude: -63.5752,
        description: 'Coordinated straw collection for energy applications.',
      },
      {
        name: 'Fraser Valley Dairy',
        waste_type: 'manure',
        quantity: 950,
        desired_type: 'organic fertilizer',
        desired_quantity: 220,
        latitude: 49.1044,
        longitude: -122.8011,
        description: 'Lower mainland dairy farm with stable manure volumes.',
      },
    ],
  });

  // Create industries (one owned by industry manager, others unowned for matching)
  await prisma.industry.create({
    data: {
      name: 'Vancouver BioEnergy',
      required_type: 'biogas feedstock',
      quantity_needed: 1200,
      byproduct_type: 'organic fertilizer',
      byproduct_quantity: 420,
      latitude: 49.2827,
      longitude: -123.1207,
      description: 'Anaerobic digestion plant seeking high-moisture biomass.',
      ownerId: industryManager.id,
    },
  });

  await prisma.industry.createMany({
    data: [
      {
        name: 'Regina Organics',
        required_type: 'organic fertilizer',
        quantity_needed: 1500,
        byproduct_type: 'biomass pellets',
        byproduct_quantity: 260,
        latitude: 50.4456,
        longitude: -104.6180,
        description: 'Soil amendment producer seeking manure-based inputs.',
      },
      {
        name: 'Winnipeg Pellets',
        required_type: 'biomass pellets',
        quantity_needed: 900,
        byproduct_type: 'organic fertilizer',
        byproduct_quantity: 180,
        latitude: 49.8955,
        longitude: -97.1400,
        description: 'Pelletizing facility converting straw to energy pellets.',
      },
      {
        name: 'Toronto Fertilizer Partners',
        required_type: 'organic fertilizer',
        quantity_needed: 1000,
        byproduct_type: 'biomass pellets',
        byproduct_quantity: 150,
        latitude: 43.6532,
        longitude: -79.3832,
        description: 'Compost and fertilizer blending facility.',
      },
      {
        name: 'Halifax Pellets',
        required_type: 'biomass pellets',
        quantity_needed: 700,
        byproduct_type: 'organic fertilizer',
        byproduct_quantity: 140,
        latitude: 44.6500,
        longitude: -63.5752,
        description: 'Biomass pellet producer for district heating.',
      },
    ],
  });

  // Seed a couple of active collaborations so they show up immediately
  const ownedFarm = await prisma.farm.findFirst({ where: { ownerId: farmManager.id } });
  const reginaOrganics = await prisma.industry.findFirst({ where: { name: 'Regina Organics' } });
  const vancouverIndustry = await prisma.industry.findFirst({ where: { ownerId: industryManager.id } });
  const fraserValley = await prisma.farm.findFirst({ where: { name: 'Fraser Valley Dairy' } });

  if (ownedFarm && reginaOrganics) {
    await prisma.collaboration.create({
      data: {
        farm_id: ownedFarm.id,
        industry_id: reginaOrganics.id,
        status: 'ACTIVE',
        notes: 'Initial pilot collaboration for manure-to-fertilizer supply.',
      },
    });
  }

  if (vancouverIndustry && fraserValley) {
    await prisma.collaboration.create({
      data: {
        farm_id: fraserValley.id,
        industry_id: vancouverIndustry.id,
        status: 'ACTIVE',
        notes: 'Local biogas feedstock partnership.',
        requestedById: industryManager.id,
        requestedByRole: industryManager.role,
      },
    });
  }

  // Pending invitation for the farm manager to accept
  if (ownedFarm && vancouverIndustry) {
    await prisma.collaboration.create({
      data: {
        farm_id: ownedFarm.id,
        industry_id: vancouverIndustry.id,
        status: 'PENDING',
        notes: 'Invitation to supply manure feedstock.',
        requestedById: industryManager.id,
        requestedByRole: industryManager.role,
      },
    });
  }

  const lakeview = await prisma.farm.findFirst({ where: { name: 'Lakeview Organics' } });
  const torontoFertilizer = await prisma.industry.findFirst({ where: { name: 'Toronto Fertilizer Partners' } });
  if (lakeview && torontoFertilizer) {
    await prisma.collaboration.create({
      data: {
        farm_id: lakeview.id,
        industry_id: torontoFertilizer.id,
        status: 'COMPLETED',
        notes: 'Completed pilot run in Q1.',
      },
    });
  }

  console.log('Seed complete.');
  console.log('Farm manager login: farm.manager@bioloop.ai / Farm1234!');
  console.log('Industry manager login: industry.manager@bioloop.ai / Industry1234!');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
