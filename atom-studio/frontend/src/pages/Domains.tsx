import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import api from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

interface Domain {
  id: string
  name: string
  description: string | null
  owner_id: string
  is_active: boolean
  litellm_team_id: string | null
  created_at: string
  agent_count: number
}

const schema = z.object({
  name: z.string().min(1, 'Name required').max(64),
  description: z.string().optional(),
})
type FormValues = z.infer<typeof schema>

async function fetchDomains(): Promise<Domain[]> {
  const { data } = await api.get<Domain[]>('/api/domains/')
  return data
}

async function createDomain(values: FormValues): Promise<Domain> {
  const { data } = await api.post<Domain>('/api/domains/', values)
  return data
}

export function Domains() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data: domains = [], isLoading } = useQuery({
    queryKey: ['domains'],
    queryFn: fetchDomains,
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '' },
  })

  const mutation = useMutation({
    mutationFn: createDomain,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] })
      setOpen(false)
      form.reset()
      toast({ title: 'Domain created', description: 'LiteLLM team provisioned.' })
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to create domain.'
      toast({ title: 'Error', description: msg, variant: 'destructive' })
    },
  })

  const onSubmit = (values: FormValues) => mutation.mutate(values)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Domains</h2>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Domain
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Agents</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domains.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No domains yet. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              domains.map(d => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="text-muted-foreground">{d.description ?? '—'}</TableCell>
                  <TableCell>{d.agent_count}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {format(new Date(d.created_at), 'MMM d, yyyy')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Domain</DialogTitle>
            <DialogDescription>
              Creates a domain and provisions a LiteLLM team for it.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="acme-corp" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional description" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
