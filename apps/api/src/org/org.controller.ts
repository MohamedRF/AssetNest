import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { OrgService } from './org.service.js';
import {
  createCategorySchema,
  createLocationSchema,
  createVendorSchema,
  updateCategorySchema,
  updateLocationSchema,
  updateVendorSchema,
  type CreateCategoryInput,
  type CreateLocationInput,
  type CreateVendorInput,
  type UpdateCategoryInput,
  type UpdateLocationInput,
  type UpdateVendorInput,
} from './dto.js';
import {
  categoryResponse,
  listCategoriesResponse,
  listLocationsResponse,
  listVendorsResponse,
  locationResponse,
  vendorResponse,
} from './openapi.js';

/** Categories, locations and vendors — org structure shared by inventory and audits. */
@ApiTags('Organization')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId', version: '1' })
export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  // ─── Categories ──────────────────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({ operationId: 'listCategories' })
  @ApiOkResponse({ schema: listCategoriesResponse })
  @RequirePermissions('assets:read')
  async listCategories(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { categories: await this.orgService.listCategories(ctx) };
  }

  @Post('categories')
  @ApiOperation({ operationId: 'createCategory' })
  @ApiBody({ schema: openApiSchema(createCategorySchema, 'input') })
  @ApiCreatedResponse({ schema: categoryResponse })
  @RequirePermissions('assets:write')
  @HttpCode(HttpStatus.CREATED)
  async createCategory(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput,
  ) {
    return this.orgService.createCategory(ctx, user.id, body);
  }

  @Patch('categories/:categoryId')
  @ApiOperation({ operationId: 'updateCategory' })
  @ApiBody({ schema: openApiSchema(updateCategorySchema, 'input') })
  @ApiOkResponse({ schema: categoryResponse })
  @RequirePermissions('assets:write')
  async updateCategory(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('categoryId') categoryId: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ) {
    return this.orgService.updateCategory(ctx, user.id, categoryId, body);
  }

  // ─── Locations ───────────────────────────────────────────────────────────

  @Get('locations')
  @ApiOperation({ operationId: 'listLocations' })
  @ApiOkResponse({ schema: listLocationsResponse })
  @RequirePermissions('assets:read')
  async listLocations(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { locations: await this.orgService.listLocations(ctx) };
  }

  @Post('locations')
  @ApiOperation({ operationId: 'createLocation' })
  @ApiBody({ schema: openApiSchema(createLocationSchema, 'input') })
  @ApiCreatedResponse({ schema: locationResponse })
  @RequirePermissions('assets:write')
  @HttpCode(HttpStatus.CREATED)
  async createLocation(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createLocationSchema)) body: CreateLocationInput,
  ) {
    return this.orgService.createLocation(ctx, user.id, body);
  }

  @Patch('locations/:locationId')
  @ApiOperation({ operationId: 'updateLocation' })
  @ApiBody({ schema: openApiSchema(updateLocationSchema, 'input') })
  @ApiOkResponse({ schema: locationResponse })
  @RequirePermissions('assets:write')
  async updateLocation(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('locationId') locationId: string,
    @Body(new ZodValidationPipe(updateLocationSchema)) body: UpdateLocationInput,
  ) {
    return this.orgService.updateLocation(ctx, user.id, locationId, body);
  }

  // ─── Vendors ─────────────────────────────────────────────────────────────

  @Get('vendors')
  @ApiOperation({ operationId: 'listVendors' })
  @ApiOkResponse({ schema: listVendorsResponse })
  @RequirePermissions('assets:read')
  async listVendors(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { vendors: await this.orgService.listVendors(ctx) };
  }

  @Post('vendors')
  @ApiOperation({ operationId: 'createVendor' })
  @ApiBody({ schema: openApiSchema(createVendorSchema, 'input') })
  @ApiCreatedResponse({ schema: vendorResponse })
  @RequirePermissions('assets:write')
  @HttpCode(HttpStatus.CREATED)
  async createVendor(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createVendorSchema)) body: CreateVendorInput,
  ) {
    return this.orgService.createVendor(ctx, user.id, body);
  }

  @Patch('vendors/:vendorId')
  @ApiOperation({ operationId: 'updateVendor' })
  @ApiBody({ schema: openApiSchema(updateVendorSchema, 'input') })
  @ApiOkResponse({ schema: vendorResponse })
  @RequirePermissions('assets:write')
  async updateVendor(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('vendorId') vendorId: string,
    @Body(new ZodValidationPipe(updateVendorSchema)) body: UpdateVendorInput,
  ) {
    return this.orgService.updateVendor(ctx, user.id, vendorId, body);
  }
}
